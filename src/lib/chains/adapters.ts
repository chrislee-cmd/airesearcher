import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLanguage } from '@/lib/transcripts/languages';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import {
  dispatchDeepgram,
  dispatchElevenLabs,
  getDeploymentBaseUrl,
  type SupabaseServer,
} from '@/lib/transcripts/dispatch';
import { resolveMime } from '@/lib/file-extract';
import { hashString } from '@/lib/cache';
import { logError } from '@/lib/observability/log-error';
import type { ChainRow } from './state';
import type { ChainStepInstance } from './registry';

// 위젯 연쇄 체인 — 단계 간 인제스트 어댑터 (PR-C).
//
// 체인의 "다음 단계 kick" 이 실제로 **데이터를 넘기는** 층이다. 사용자가 손으로
// 하던 두 이동을 서버가 수행한다(점검 보고서 §6-C):
//
//   1. 프로빙 녹음 → 전사록   (probing-session-audio → audio-uploads → 전사 job)
//   2. 전사 markdown → 인터뷰 분석 (transcript_jobs.markdown → convert → index)
//
// **이 모듈은 상태 전이를 소유하지 않는다.** 체인 status(running/awaiting/
// paused/error) 전이는 B(advance 훅)의 몫이고, 여기서는 단계 단위의 사실만
// 기록한다 — 성공 시 steps[].job_ref, 실패 시 steps[].status='error' +
// steps[].error. 실패가 어디에도 남지 않아 체인이 조용히 멈추는 "유령 전이"를
// 금지하기 위한 분담(#1319 교훈). 호출측(B)은 반환된 AdapterResult 를 보고
// 체인 레벨 status 만 전이하면 되고, steps[] 를 다시 쓸 필요가 없다.
//
// topline kick(POST /api/interviews/v2/topline)은 **이 모듈 범위 밖**이다 —
// 넘길 파일이 없어 어댑터가 필요 없고, B 가 직접 호출한다(중복 구현 금지).
//
// ⚠️ 서버 전용. 서비스롤 클라이언트와 CRON_SECRET 을 쓰므로 클라이언트
// 컴포넌트에서 import 하면 안 된다.
//
// 실행 예산: 두 어댑터 모두 **kick 만** 하고 긴 작업(전사·임베딩)은 각 위젯의
// 기존 비동기 경로에 맡긴다(R10). 그래도 어댑터 2 는 convert 왕복을 기다리므로
// (md 경로라 보통 수 초) 호출측은 전사 done 지점의 maxDuration(200s) 안에서
// 부르거나 `after()` 로 응답 뒤로 미루는 것이 안전하다.

type AdminClient = ReturnType<typeof createAdminClient>;

// 프로빙 세션 녹음이 영속되는 버킷(#554). 클라이언트가 세션 종료 시 blob 을
// 직접 올리고 `probing_session_recordings` 에 메타 row 를 남긴다.
const PROBING_BUCKET = 'probing-session-audio';
// 전사·인터뷰 분석이 공통으로 읽는 입력 버킷. RLS(audio_user_insert)가
// `foldername[1] = auth.uid()` 라, 넘기는 object 도 반드시 `<userId>/` prefix
// 아래 두어야 소유자 세션이 나중에 같은 키를 읽을 수 있다.
const UPLOAD_BUCKET = 'audio-uploads';

// MIME 보정을 위해 **재호스팅**(download → upload)해야 할 때의 크기 상한.
// MIME 이 이미 신뢰 가능하면 서버측 copy 로 끝나므로 이 상한에 걸리지 않는다
// (copy 는 바이트를 함수로 끌어오지 않아 사실상 무제한). 재호스팅은 바이트가
// 함수 메모리를 통과하므로 interviews/convert 의 25MB 게이트와 같은 선에서
// 끊고, 넘으면 **모호하지 않은 사유**로 실패시킨다(조용한 OOM 금지).
const MIME_FIX_MAX_BYTES = 25 * 1024 * 1024;

// 전사 markdown 이 이 크기를 넘으면 convert 의 25MB 게이트에서 413 으로 떨어
// 진다. 어댑터가 먼저 끊어 사유를 명확히 남긴다.
const MAX_MARKDOWN_BYTES = 25 * 1024 * 1024;

export type AdapterOk = {
  ok: true;
  /** 이 단계가 kick 한 위젯 job id — steps[].job_ref 에 기록된 값. */
  jobRef: string;
};

export type AdapterFail = {
  ok: false;
  /** 기계가 분기할 수 있는 짧은 사유 코드. steps[].error 에도 기록된다. */
  reason: string;
  /**
   * 크레딧 부족(402). B 는 체인을 `paused_insufficient_credits` 로 전이하고
   * 표면화해야 한다 — 조용한 실패 금지(R9).
   */
  insufficientCredits?: boolean;
  /**
   * 아직 준비가 안 된 것(녹음 업로드 진행 중, 전사 미완료 등). 영구 실패가
   * 아니므로 B/sweep 이 다시 시도해도 된다. 이 경우 단계는 error 로 마킹하지
   * 않는다(재시도 가능한 상태를 영구 실패로 굳히지 않기 위해).
   */
  retryable?: boolean;
};

export type AdapterResult = AdapterOk | AdapterFail;

// ── 단계 기록 (steps jsonb) ───────────────────────────────────────────────

/**
 * steps[stepIndex] 를 patch 한다. **항상 DB 에서 row 를 다시 읽고** 수정하므로,
 * 호출측이 들고 있던 낡은 steps 스냅샷으로 다른 단계의 기록을 덮어쓰지 않는다
 * (어댑터가 기록한 error 를 B 의 후속 전이가 지우는 사고 방지).
 *
 * best-effort: 기록 실패가 kick 결과를 바꾸지 않는다(로그만).
 */
async function patchStep(
  admin: AdminClient,
  chainId: string,
  stepIndex: number,
  patch: Partial<ChainStepInstance>,
): Promise<void> {
  try {
    const { data, error } = await admin
      .from('widget_chains')
      .select('steps')
      .eq('id', chainId)
      .maybeSingle();
    if (error || !data) return;
    const steps = (data.steps ?? []) as ChainStepInstance[];
    if (stepIndex < 0 || stepIndex >= steps.length) return;
    const next = steps.map((s, i) => (i === stepIndex ? { ...s, ...patch } : s));
    await admin.from('widget_chains').update({ steps: next }).eq('id', chainId);
  } catch (e) {
    console.error(
      '[chains/adapters] step patch failed',
      chainId,
      stepIndex,
      e instanceof Error ? e.message : e,
    );
  }
}

/** 성공 — 이 단계가 kick 한 위젯 job id 를 기록한다. */
export async function recordStepJobRef(
  admin: AdminClient,
  chainId: string,
  stepIndex: number,
  jobRef: string,
): Promise<void> {
  await patchStep(admin, chainId, stepIndex, {
    job_ref: jobRef,
    status: 'running',
    error: null,
  });
}

/**
 * 실패 — 단계를 error 로 마킹하고 사유를 남긴다. 체인 레벨 status 전이는 B.
 * 사유는 DB 에 들어가므로 길이를 자른다.
 */
export async function recordStepFailure(
  admin: AdminClient,
  chainId: string,
  stepIndex: number,
  reason: string,
): Promise<void> {
  await patchStep(admin, chainId, stepIndex, {
    status: 'error',
    error: reason.slice(0, 500),
  });
}

// 실패를 기록하고 같은 사유를 반환하는 내부 shortcut. retryable 실패는 단계를
// error 로 굳히지 않고 사유만 남긴다(재시도 여지 보존).
async function fail(
  admin: AdminClient,
  chain: ChainRow,
  stepIndex: number,
  reason: string,
  extra?: Omit<AdapterFail, 'ok' | 'reason'>,
): Promise<AdapterFail> {
  if (extra?.retryable) {
    await patchStep(admin, chain.id, stepIndex, { error: reason.slice(0, 500) });
  } else {
    await recordStepFailure(admin, chain.id, stepIndex, reason);
  }
  return { ok: false, reason, ...extra };
}

// ── 공용 헬퍼 ─────────────────────────────────────────────────────────────

// upload-url 라우트들의 safeFilename 과 같은 규칙 — 디렉토리 탈출 제거, 확장자
// 보존, 안전 문자만. (라우트의 로컬 함수라 export 가 없어 규칙만 미러한다.)
function safeFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const cleanedBase = base
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 120);
  const cleanedExt = ext.replace(/[^A-Za-z0-9.]+/g, '');
  return `${cleanedBase || 'file'}${cleanedExt}`;
}

function basename(key: string): string {
  const parts = key.split('/');
  return parts[parts.length - 1] || 'recording';
}

/**
 * 체인이 전달하는 object 의 목적지 키.
 *
 * · 소유자(`chain.created_by`) prefix 아래 — audio-uploads RLS 와 convert 의
 *   `<userId>/` 소유 검사를 동시에 만족시킨다.
 * · **결정적**(타임스탬프 없음, chain id + 단계 인덱스로 구성) — 실패분을
 *   보존하는 #1320 규약(아래 호출부)과 재시도가 공존해야 하기 때문이다. 키에
 *   Date.now() 를 넣으면 재시도마다 새 object 가 생겨 "보존된" 실패분이 영구
 *   고아로 쌓인다. 같은 단계의 재시도는 같은 키를 덮어쓰므로(upsert) 고아가
 *   1개를 넘지 않는다.
 * · 체인 id 가 키에 박혀 있어 스토리지만 보고도 출처를 알 수 있다.
 */
function chainObjectKey(
  chain: ChainRow,
  stepIndex: number,
  filename: string,
): string {
  return `${chain.created_by}/chain-${chain.id}-step${stepIndex}-${safeFilename(
    filename,
  )}`;
}

/** chain.project_id 가 실제로 이 org 의 interview_projects 인지 확인. */
async function projectBelongsToOrg(
  admin: AdminClient,
  projectId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle();
  return Boolean(data);
}

/** best-effort scratch 정리. 성공 경로에서만 호출한다(실패분은 보존 — #1320). */
async function removeObject(
  admin: AdminClient,
  bucket: string,
  key: string,
): Promise<void> {
  try {
    await admin.storage.from(bucket).remove([key]);
  } catch {
    // 고아 object — 무해하고 스토리지 수명주기가 회수한다.
  }
}

/**
 * object 의 **실제** content-type 을 읽는다. 전사 provider 는 signed URL 로
 * 바이트를 가져가면서 이 헤더를 보고 포맷을 판별하므로, DB 메타(row.mime)가
 * 아니라 object 쪽 값이 진짜 입력이다. `probing_session_recordings.mime` 은
 * 클라이언트가 선언한 값이고 라우트가 빈 값을 'audio/webm' 으로 채우기까지
 * 해서, row 만 믿으면 "메타는 맞는데 object 는 빈 MIME" 인 조합을 못 잡는다 —
 * 2026-09-10 사고의 정확한 형태다(R6).
 *
 * 읽기 실패 시 null — 호출측이 row 메타로 폴백한다.
 */
async function objectContentType(
  admin: AdminClient,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const slash = key.lastIndexOf('/');
    const dir = slash >= 0 ? key.slice(0, slash) : '';
    const name = slash >= 0 ? key.slice(slash + 1) : key;
    const { data } = await admin.storage
      .from(bucket)
      .list(dir, { search: name, limit: 100 });
    const hit = data?.find((o) => o.name === name);
    const mimetype = (hit?.metadata as { mimetype?: unknown } | null)?.mimetype;
    return typeof mimetype === 'string' && mimetype ? mimetype : null;
  } catch {
    return null;
  }
}

/**
 * 다음 인덱싱 홉을 kick 한다 — `/api/interviews/index` 의 재개 경로
 * (`{ interview_job_id, resume: true }` + CRON_SECRET Bearer)를 그대로 탄다.
 * 그 핸들러가 interview_documents 에서 markdown 을 reload 해 임베딩·청크 삽입
 * ·완료 마킹까지 수행한다(#608 durable-resume 패턴).
 *
 * 라우트의 `retriggerIndex` 를 import 하지 않고 같은 호출을 여기서 구성하는
 * 이유: B(advance 훅)가 index 라우트 말단에 체인 advance 를 걸면
 * `index/route → chains/* → index/route` 순환 import 가 생긴다. 호출 계약
 * (경로·바디·Bearer)은 얇고 안정적이라 중복이 순환보다 싸다.
 */
async function kickIndexResume(interviewJobId: string): Promise<boolean> {
  const base = getDeploymentBaseUrl();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}/api/interviews/index`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          interview_job_id: interviewJobId,
          resume: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      console.warn(
        '[chains/adapters] index kick non-ok',
        res.status,
        `(${attempt + 1}/3)`,
      );
    } catch (e) {
      // 15s 타임아웃으로 abort 돼도 서버측 홉은 이미 시작됐을 수 있다 —
      // 재시도는 멱등(resume 은 index_status='indexing' 인 잡만 집는다).
      console.warn(
        `[chains/adapters] index kick failed (${attempt + 1}/3)`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  // 끊겨도 /api/cron/index-resume-sweep 이 백스톱으로 재점화한다.
  return false;
}

// ── 어댑터 1: 프로빙 녹음 → 전사록 ────────────────────────────────────────

/**
 * 프로빙 세션의 녹음을 전사 파이프라인에 넘긴다.
 *
 * 왜 서버가 버킷 간 전달을 해야 하나(리스크 R5): 녹음은
 * `probing-session-audio` 에, 전사 입력은 `audio-uploads` 에 있고 둘 다 소유자
 * 경로 RLS 다. cross-bucket signed URL 을 provider 에 그대로 넘기는 것보다,
 * 서비스롤이 **대상 버킷의 소유자 경로로 옮기는 것**이 RLS 가 단순하고(새 정책
 * 0) 전사록 위젯의 기존 재시도·다운로드 경로가 그대로 동작한다.
 *
 * 왜 MIME 을 보정하나(리스크 R6): iOS/macOS `.m4a` 는 빈 MIME 으로 올라오는
 * 일이 흔하고, 그게 2026-09-10 "녹음을 415 로 거절" 사고의 원인이었다. 선언된
 * MIME 이 비었거나 generic 이면 확장자 폴백(file-extract 의 분류 regex 재사용)
 * 으로 교체한다. 교체가 필요하면 copy 로는 content-type 을 바꿀 수 없으므로
 * **재호스팅**(download → explicit contentType upload)한다.
 *
 * 타이밍: 녹음 blob 업로드와 메타 row insert 는 세션 종료 **후** 클라이언트가
 * 수행한다. 훅이 먼저 도달하면 row 가 아직 없을 수 있으므로, 그 경우는
 * `retryable` 실패로 돌려준다(영구 실패로 굳히지 않는다).
 */
export async function kickTranscriptFromProbingRecording(args: {
  chain: ChainRow;
  stepIndex: number;
  /** 종료된 프로빙 세션 id. 이 세션의 최신 녹음을 집는다. */
  sessionId: string;
  /** 특정 녹음을 지정할 때(옵션). 없으면 sessionId 의 최신 녹음. */
  recordingId?: string | null;
  admin?: AdminClient;
}): Promise<AdapterResult> {
  const { chain, stepIndex, sessionId, recordingId } = args;
  const admin = args.admin ?? createAdminClient();

  // 1. 녹음 메타 — 반드시 체인의 org 로 스코프(타 테넌트 object 참조 차단).
  let query = admin
    .from('probing_session_recordings')
    .select('id, storage_key, mime, size_bytes')
    .eq('org_id', chain.org_id)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (recordingId) query = query.eq('id', recordingId);

  const { data: recordings, error: recErr } = await query;
  if (recErr) {
    return fail(admin, chain, stepIndex, `recording_lookup_failed: ${recErr.message}`);
  }
  const recording = recordings?.[0];
  if (!recording) {
    // 아직 업로드/메타 insert 가 안 끝났을 수 있다 — 재시도 가능.
    return fail(admin, chain, stepIndex, 'recording_not_found', {
      retryable: true,
    });
  }

  const filename = basename(recording.storage_key);
  // object 의 실제 content-type 우선, 못 읽으면 row 메타로 폴백.
  const declaredMime =
    (await objectContentType(admin, PROBING_BUCKET, recording.storage_key)) ??
    ((recording.mime as string | null) ?? null);
  const resolvedMime = resolveMime(filename, declaredMime);
  if (!resolvedMime) {
    // 확장자로도 분류가 안 되는 파일 — provider 가 어차피 거절한다. 모호한
    // 415 대신 여기서 명확히 끊는다.
    return fail(
      admin,
      chain,
      stepIndex,
      `unsupported_recording_format: ${filename} (mime=${declaredMime ?? 'empty'})`,
    );
  }
  const needsRehost = resolvedMime !== declaredMime;
  const sizeBytes = (recording.size_bytes as number | null) ?? null;

  // 2. 전사 입력 버킷의 소유자 경로로 전달.
  const destKey = chainObjectKey(chain, stepIndex, filename);
  if (needsRehost) {
    if (sizeBytes !== null && sizeBytes > MIME_FIX_MAX_BYTES) {
      return fail(
        admin,
        chain,
        stepIndex,
        `recording_too_large_for_mime_fix: ${sizeBytes}B > ${MIME_FIX_MAX_BYTES}B (mime=${
          declaredMime ?? 'empty'
        })`,
      );
    }
    // MIME 보정 경로 — copy 는 object 의 content-type 을 바꿀 수 없어 바이트를
    // 다시 올린다. 빈 MIME `.m4a` 가 정확히 이 경로를 탄다.
    const { data: blob, error: dlErr } = await admin.storage
      .from(PROBING_BUCKET)
      .download(recording.storage_key);
    if (dlErr || !blob) {
      return fail(
        admin,
        chain,
        stepIndex,
        `recording_download_failed: ${dlErr?.message ?? 'empty'}`,
      );
    }
    const { error: upErr } = await admin.storage
      .from(UPLOAD_BUCKET)
      // upsert — 같은 단계의 재시도가 같은 키를 덮어쓴다(고아 누적 방지).
      .upload(destKey, blob, { contentType: resolvedMime, upsert: true });
    if (upErr) {
      return fail(admin, chain, stepIndex, `recording_upload_failed: ${upErr.message}`);
    }
  } else {
    // MIME 이 이미 신뢰 가능 — 서버측 copy(바이트가 함수를 통과하지 않음).
    // copy 는 upsert 옵션이 없어 같은 키가 남아 있으면 409 가 된다. 키가
    // 결정적이므로 재시도 시 그 상황이 실제로 생긴다 → 먼저 비운다.
    await removeObject(admin, UPLOAD_BUCKET, destKey);
    const { error: cpErr } = await admin.storage
      .from(PROBING_BUCKET)
      .copy(recording.storage_key, destKey, {
        destinationBucket: UPLOAD_BUCKET,
      });
    if (cpErr) {
      return fail(admin, chain, stepIndex, `recording_copy_failed: ${cpErr.message}`);
    }
  }

  // 3. 전사 job row. 체인은 언어를 고르지 않으므로 전사록 위젯의 기본값
  //    (language 미지정 → multi → ElevenLabs Scribe)을 그대로 쓴다.
  const langEntry = getLanguage(null);
  const provider = langEntry.provider;
  const apiModel = provider === 'deepgram' ? langEntry.dgModel : ELEVENLABS_API_MODEL;

  const projectId =
    chain.project_id && (await projectBelongsToOrg(admin, chain.project_id, chain.org_id))
      ? chain.project_id
      : null;

  const { data: job, error: insertErr } = await admin
    .from('transcript_jobs')
    .insert({
      org_id: chain.org_id,
      project_id: projectId,
      user_id: chain.created_by,
      storage_key: destKey,
      filename,
      mime_type: resolvedMime,
      size_bytes: sizeBytes,
      provider,
      model: apiModel,
      mode: 'research',
      speaker_count: null,
      status: 'submitting',
    })
    .select('id')
    .single();
  if (insertErr || !job) {
    // job row 가 없으면 방금 옮긴 object 를 참조하는 것이 아무것도 없다 —
    // 고아를 남기지 않고 지운다(실패분 보존 규약은 "참조가 있는 것" 대상).
    await removeObject(admin, UPLOAD_BUCKET, destKey);
    return fail(
      admin,
      chain,
      stepIndex,
      `transcript_job_insert_failed: ${insertErr?.message ?? 'db_error'}`,
    );
  }
  const jobId = job.id as string;

  // 4. provider 가 가져갈 6h signed URL — transcripts/start 와 동일.
  const { data: signed, error: signedErr } = await admin.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(destKey, 60 * 60 * 6);
  if (signedErr || !signed?.signedUrl) {
    const reason = `sign_failed: ${signedErr?.message ?? 'empty'}`;
    await admin
      .from('transcript_jobs')
      .update({ status: 'error', error_message: reason })
      .eq('id', jobId);
    return fail(admin, chain, stepIndex, reason);
  }

  // 5. dispatch — 전사록 위젯이 쓰는 **바로 그** 유료 경로를 재사용한다
  //    (lib/transcripts/dispatch). 실패 시 dispatch 가 job row 를 error 로
  //    마킹하므로, 여기서는 사유만 체인 단계로 옮긴다.
  //
  //    캐스팅 이유: 이 헬퍼들은 라우트에서 넘어오는 **세션** 클라이언트 타입을
  //    받도록 선언돼 있지만, 내부에서 하는 일은 transcript_jobs 업데이트뿐이라
  //    서비스롤 클라이언트로도 동일하게 동작한다. 전사록 위젯이 공유하는 유료
  //    경로의 시그니처를 건드리지 않기 위해 호출 지점에서만 좁혀 캐스팅한다.
  const dispatchClient = admin as unknown as SupabaseServer;
  const dispatched =
    provider === 'deepgram'
      ? await dispatchDeepgram({
          supabase: dispatchClient,
          jobId,
          signedUrl: signed.signedUrl,
          langEntry,
        })
      : await dispatchElevenLabs({
          supabase: dispatchClient,
          jobId,
          signedUrl: signed.signedUrl,
          apiModel,
          languageCode: langEntry.code === 'multi' ? null : langEntry.dgLanguage,
          numSpeakers: null,
        });

  if (!dispatched.ok) {
    const body = (await dispatched.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    const reason = `transcribe_dispatch_failed: ${
      body.error ?? dispatched.status
    }${body.detail ? ` (${body.detail.slice(0, 200)})` : ''}`;
    await logError({
      feature: 'transcript',
      code: 'chain_transcribe_dispatch_failed',
      message: reason,
      context: { chain_id: chain.id, transcript_job_id: jobId, org_id: chain.org_id },
    });
    return fail(admin, chain, stepIndex, reason);
  }

  await recordStepJobRef(admin, chain.id, stepIndex, jobId);
  return { ok: true, jobRef: jobId };
}

// ── 어댑터 2: 전사 markdown → 인터뷰 분석 인제스트 ────────────────────────

/**
 * 완료된 전사록의 markdown 을 인터뷰 분석(코퍼스 인덱싱)에 넘긴다. 사용자가
 * 손으로 하던 경로 — 전사록 다운로드 → 인터뷰 분석 업로드 — 를 서버가 한다.
 *
 * 경로: markdown → `audio-uploads` 의 scratch `.md` object →
 * `/api/interviews/convert` JSON 경로 → interview_jobs/interview_documents →
 * index 재개 홉. **convert·index 는 그대로 쓴다** — 포맷팅·캐시·차감·청크·
 * 재개가 전부 기존 코드다. 체인이 새로 만드는 것은 "넘기는 동작" 뿐이다.
 *
 * 차감: convert 의 기존 `spendCredits('quotes')` 가 그대로 발화한다. 체인은
 * 차감을 우회하지도 추가하지도 않으며, 402 는 `insufficientCredits` 로 돌려
 * B 의 `paused_insufficient_credits` 전이에 넘긴다(R9).
 *
 * scratch: convert 가 성공 시 자기 손으로 scratch object 를 지우고 실패 시
 * 남긴다(#1320 규약). 어댑터는 그 규약을 그대로 상속하므로 성공 경로에서
 * 따로 지우지 않는다 — 실패분을 남기는 것이 의도된 동작이다(재시도가 같은
 * object 를 다시 읽을 수 있다). 키가 결정적이라(chainObjectKey) 보존된
 * 실패분은 재시도에 덮어쓰여 고아가 누적되지 않는다.
 *
 * 프로젝트 스코프(R8): 인터뷰 분석은 project 단위라 `chain.project_id` 가
 * 반드시 있어야 한다. null 인 체인은 이 단계에 진입할 수 없고, D(UI)가
 * awaiting 단계에서 프로젝트 선택을 요구한다.
 */
export async function kickInterviewIngestFromTranscript(args: {
  chain: ChainRow;
  stepIndex: number;
  /** 직전 단계가 완료한 transcript_jobs.id. */
  transcriptJobId: string;
  admin?: AdminClient;
}): Promise<AdapterResult> {
  const { chain, stepIndex, transcriptJobId } = args;
  const admin = args.admin ?? createAdminClient();

  // 1. 대상 프로젝트 확정 — 없으면 진입 불가(유령 인제스트 금지). 단계를
  //    error 로 **굳히지 않고** retryable 로 돌린다: 사용자가 D(UI)의 awaiting
  //    단계에서 프로젝트를 고르는 순간 조건이 해소되므로, 영구 실패로 박아
  //    두면 고른 뒤에도 진행할 수 없게 된다.
  if (!chain.project_id) {
    return fail(admin, chain, stepIndex, 'chain_project_required', {
      retryable: true,
    });
  }
  if (!(await projectBelongsToOrg(admin, chain.project_id, chain.org_id))) {
    return fail(admin, chain, stepIndex, 'chain_project_not_in_org');
  }
  const projectId = chain.project_id;

  // 2. 전사 결과 — org 스코프. 아직 done 이 아니면 재시도 가능.
  const { data: tjob, error: tErr } = await admin
    .from('transcript_jobs')
    .select('id, status, markdown, filename')
    .eq('id', transcriptJobId)
    .eq('org_id', chain.org_id)
    .maybeSingle();
  if (tErr) {
    return fail(admin, chain, stepIndex, `transcript_lookup_failed: ${tErr.message}`);
  }
  if (!tjob) {
    return fail(admin, chain, stepIndex, 'transcript_job_not_found');
  }
  if (tjob.status !== 'done') {
    return fail(admin, chain, stepIndex, `transcript_not_done: ${tjob.status}`, {
      retryable: true,
    });
  }
  const markdown = ((tjob.markdown as string | null) ?? '').trim();
  if (!markdown) {
    return fail(admin, chain, stepIndex, 'transcript_markdown_empty');
  }
  const markdownBytes = Buffer.byteLength(markdown, 'utf8');
  if (markdownBytes > MAX_MARKDOWN_BYTES) {
    return fail(
      admin,
      chain,
      stepIndex,
      `transcript_markdown_too_large: ${markdownBytes}B > ${MAX_MARKDOWN_BYTES}B`,
    );
  }

  // 3. scratch `.md` 적재 — convert 가 키로 읽어간다. 확장자가 `.md` 라
  //    convert 는 text 경로(LLM 0회·rate limit 0회)로 포맷한다.
  const sourceName = ((tjob.filename as string | null) ?? 'transcript').replace(
    /\.[^./]+$/,
    '',
  );
  const mdFilename = `${safeFilename(sourceName) || 'transcript'}.md`;
  const scratchKey = chainObjectKey(chain, stepIndex, mdFilename);
  const { error: upErr } = await admin.storage
    .from(UPLOAD_BUCKET)
    .upload(scratchKey, Buffer.from(markdown, 'utf8'), {
      contentType: 'text/markdown',
      // upsert — 보존된 실패분을 재시도가 덮어쓴다(고아 누적 방지).
      upsert: true,
    });
  if (upErr) {
    return fail(admin, chain, stepIndex, `markdown_upload_failed: ${upErr.message}`);
  }

  // 4. convert — 내부(CRON_SECRET) 인증으로 세션 없이 호출한다. 행위자·테넌트
  //    는 체인 row 에서 명시 전달(convert 가 `<user_id>/` 소유 검사를 그대로
  //    적용하므로 scratchKey 의 prefix 와 일치해야 한다).
  let convertRes: Response;
  try {
    convertRes = await fetch(`${getDeploymentBaseUrl()}/api/interviews/convert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        storage_key: scratchKey,
        filename: mdFilename,
        mime: 'text/markdown',
        project_id: projectId,
        chain_user_id: chain.created_by,
        chain_org_id: chain.org_id,
      }),
      // md 경로는 LLM 을 안 타 보통 수 초다. 상한은 호출측 예산에 맞춰
      // 보수적으로 둔다 — 이 어댑터는 전사 done 지점(webhook/poll,
      // maxDuration 200s)에서 불리므로 그 안에서 끝나야 한다.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    return fail(
      admin,
      chain,
      stepIndex,
      `convert_unreachable: ${e instanceof Error ? e.message : 'fetch_failed'}`,
      { retryable: true },
    );
  }

  if (convertRes.status === 402) {
    // 크레딧 부족 — 체인을 멈추고 반드시 표면화한다(조용한 실패 금지).
    return fail(admin, chain, stepIndex, 'insufficient_credits', {
      insufficientCredits: true,
    });
  }
  if (!convertRes.ok) {
    const body = (await convertRes.json().catch(() => ({}))) as { error?: string };
    const reason = `convert_failed: ${body.error ?? convertRes.status}`;
    await logError({
      feature: 'interview',
      code: 'chain_convert_failed',
      message: reason,
      context: {
        chain_id: chain.id,
        transcript_job_id: transcriptJobId,
        org_id: chain.org_id,
      },
    });
    return fail(admin, chain, stepIndex, reason);
  }
  const converted = (await convertRes.json().catch(() => ({}))) as {
    markdown?: string;
    filename?: string;
  };
  const formatted = (converted.markdown ?? '').trim();
  if (!formatted) {
    return fail(admin, chain, stepIndex, 'convert_empty');
  }

  // 5. 이 인제스트를 소유할 interview_job — 수동 업로드 경로(provider)가
  //    /api/interviews/jobs 로 만드는 row 와 같은 shape.
  const { data: ijob, error: ijErr } = await admin
    .from('interview_jobs')
    .insert({
      org_id: chain.org_id,
      project_id: projectId,
      user_id: chain.created_by,
      inputs: [{ filename: converted.filename ?? mdFilename, mime: 'text/markdown' }],
      extractions: {},
      matrix: {},
      consolidated: null,
      status: 'done',
    })
    .select('id')
    .single();
  if (ijErr || !ijob) {
    return fail(
      admin,
      chain,
      stepIndex,
      `interview_job_insert_failed: ${ijErr?.message ?? 'db_error'}`,
    );
  }
  const interviewJobId = ijob.id as string;

  // 6. 문서 영속 — index 의 최초 홉이 하는 일과 동일(project 스코프
  //    content_hash dedupe). 이걸 먼저 해 두면 인덱싱 자체는 라우트의 검증된
  //    **재개 홉**이 그대로 수행할 수 있다(#608 durable-resume 재사용).
  const contentHash = hashString(formatted);
  const docRow = {
    org_id: chain.org_id,
    project_id: projectId,
    interview_job_id: interviewJobId,
    filename: converted.filename ?? mdFilename,
    mime: 'text/markdown',
    markdown: formatted,
    content_hash: contentHash,
    char_count: formatted.length,
  };
  const { data: insertedDocs, error: docErr } = await admin
    .from('interview_documents')
    .upsert(docRow, {
      onConflict: 'project_id,content_hash',
      ignoreDuplicates: true,
    })
    .select('id');
  if (docErr) {
    return fail(admin, chain, stepIndex, `document_insert_failed: ${docErr.message}`);
  }
  if (!insertedDocs || insertedDocs.length === 0) {
    // 같은 내용이 이 프로젝트에 이미 인덱싱돼 있다 — 재인제스트할 것이 없다.
    // 중복 청크를 만들지 않고 기존 잡을 가리킨다(멱등). 참고로 같은 바이트의
    // 재convert 는 convert 의 content-addressed 캐시에 적중해 차감 없이
    // 돌아오므로, 이 분기가 중복 차감을 만들지도 않는다.
    const { data: existing } = await admin
      .from('interview_documents')
      .select('interview_job_id')
      .eq('project_id', projectId)
      .eq('content_hash', contentHash)
      .maybeSingle();
    const existingJobRef = (existing?.interview_job_id as string | null) ?? null;
    if (existingJobRef) {
      // 방금 만든 빈 잡은 소유할 문서가 없다 — 대시보드에 "결과 0" 유령
      // 아티팩트로 남지 않게 지운다(#1319 유령 완료 교훈).
      await admin
        .from('interview_jobs')
        .delete()
        .eq('id', interviewJobId)
        .eq('org_id', chain.org_id);
      await recordStepJobRef(admin, chain.id, stepIndex, existingJobRef);
      return { ok: true, jobRef: existingJobRef };
    }
    // 충돌은 보고됐는데 기존 row 를 못 읽는다 — 중복 삽입을 감행하지 않고
    // 정직하게 실패한다(index 라우트의 같은 방어와 동일 판단).
    await admin
      .from('interview_jobs')
      .delete()
      .eq('id', interviewJobId)
      .eq('org_id', chain.org_id);
    return fail(admin, chain, stepIndex, 'document_conflict_unreadable');
  }

  // 7. 인덱싱 착수 — 'indexing' 으로 두고 재개 홉을 kick 한다. 그 핸들러가
  //    문서를 reload 해 임베딩·청크 삽입·done/error 마킹까지 끝낸다. kick 이
  //    끊기더라도 index-resume-sweep cron 이 백스톱이라 영구 정지하지 않는다.
  await admin
    .from('interview_jobs')
    .update({ index_status: 'indexing', index_cursor: 0, index_resume_count: 0 })
    .eq('id', interviewJobId)
    .eq('org_id', chain.org_id);

  await kickIndexResume(interviewJobId);

  await recordStepJobRef(admin, chain.id, stepIndex, interviewJobId);
  return { ok: true, jobRef: interviewJobId };
}
