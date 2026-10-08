import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { env } from '@/env';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  spendCredits,
  spendCreditsAdmin,
  getCreditsStatus,
  getCreditsStatusAdmin,
} from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { classifyFile, extractDocText } from '@/lib/file-extract';
import {
  tryRegexMarkdown,
  tryMarkdownPassthrough,
} from '@/lib/markdown-format';
import { hashBytes, getCache, setCache } from '@/lib/cache';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { ISOLATION_NOTICE, sanitizeUserInput } from '@/lib/llm/sanitize';
import { logError } from '@/lib/observability/log-error';

export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;
// Reused Storage bucket for direct browser uploads (same as transcripts). The
// bytes land here via TUS before convert reads them back by key — see
// /api/interviews/upload-url.
const UPLOAD_BUCKET = 'audio-uploads';

const SYSTEM = `당신은 인터뷰 텍스트를 깔끔한 Markdown 인터뷰 노트로 정리하는 작성자입니다.
- 인터뷰어의 질문은 \`## Q. <원문 질문>\` 형태로 시작합니다.
- 응답자의 답변은 질문 바로 아래 본문 단락으로 옮깁니다. 길면 단락을 나눕니다.
- 명백한 메타데이터(인터뷰 일자, 응답자 ID 등)가 있으면 문서 상단의 \`---\` YAML front matter로 정리합니다.
- 원문 의미를 임의로 요약하지 말고, 단순한 잡음(기침, 의미없는 추임새, "음", "어")만 제거합니다.
- 출력은 순수한 Markdown 텍스트만, 코드펜스/추가 설명 없이.${ISOLATION_NOTICE}`;

// Structured, greppable failure log. Every non-200 convert exit passes through
// here so Vercel logs can be filtered by `[interviews/convert] fail` and the
// reason/stage grouped — rate_limited (starvation), unsupported, no_text,
// extract failures, etc. The client aggregates the same reasons into the job's
// error_message; this is the log-side half of the same observability.
function logConvertFail(info: {
  name: string;
  stage: string;
  reason: string;
  status: number;
}): void {
  console.error('[interviews/convert] fail', info);
}

// JSON intake body. `chain_*` are only read on the internal (CRON_SECRET)
// path — a session caller sending them changes nothing, because the session
// branch never looks at them.
type ConvertJsonBody = {
  storage_key?: unknown;
  filename?: unknown;
  mime?: unknown;
  project_id?: unknown;
  chain_user_id?: unknown;
  chain_org_id?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export async function POST(request: Request) {
  // Two intake paths share one body read. The JSON body has to be parsed
  // BEFORE auth because the internal (chain) caller carries its identity in
  // the body — Request bodies can only be consumed once, so reading it twice
  // would throw.
  const contentType = request.headers.get('content-type') ?? '';
  const isJsonIntake = contentType.includes('application/json');
  const jsonBody = isJsonIntake
    ? ((await request.json().catch(() => null)) as ConvertJsonBody | null)
    : null;

  const supabase = await createClient();

  // ── 인증: 세션(사용자) 또는 내부 호출(위젯 체인 어댑터) ──
  // 체인의 인제스트 어댑터(src/lib/chains/adapters.ts)는 전사 완료 webhook 등
  // **세션 없는 서버 지점**에서 돌기 때문에 쿠키가 없다. 세션 대신 CRON_SECRET
  // Bearer 로 신뢰하고, 행위자(user_id)·테넌트(org_id)를 body 로 명시 전달받는
  // 다 — /api/interviews/index 의 재개 홉이 이미 쓰는 패턴과 동일. 내부 경로는
  // auth.uid() 가 없어 RLS 가 아무 row 도 못 보므로, 아래 데이터 접근은
  // 서비스롤 클라이언트(`db`)로 수행한다.
  //
  // 신뢰 경계는 그대로다: storage_key 는 여전히 `<user_id>/` prefix 여야 하고
  // (아래 검사), 차감도 같은 지점에서 같은 금액으로 발화한다. 체인은 차감을
  // 우회하지도 추가하지도 않는다.
  const isInternal =
    (request.headers.get('authorization') ?? '') === `Bearer ${env.CRON_SECRET}`;
  let userId: string;
  let orgId: string;
  let actorEmail: string | null = null;
  let internal = false;
  if (isInternal && jsonBody) {
    const uid = jsonBody.chain_user_id;
    const oid = jsonBody.chain_org_id;
    if (!isUuid(uid) || !isUuid(oid)) {
      logConvertFail({
        name: 'internal',
        stage: 'validate',
        reason: 'invalid_internal_identity',
        status: 400,
      });
      return NextResponse.json(
        { error: 'invalid_internal_identity' },
        { status: 400 },
      );
    }
    userId = uid;
    orgId = oid;
    internal = true;
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const org = await getActiveOrg();
    if (!org) {
      return NextResponse.json({ error: 'no_organization' }, { status: 403 });
    }
    userId = user.id;
    orgId = org.org_id;
    actorEmail = user.email ?? null;
  }

  // Data-access client. The session path keeps the RLS-scoped client it always
  // used; the internal path must use the service role (no auth.uid()).
  const db = internal ? createAdminClient() : supabase;

  // NOTE: the per-user/per-org LLM rate limit is applied lazily, only on the
  // paths that actually call an LLM (audio/video transcription, or the Sonnet
  // markdown-format fallback) — see checkLlmRateLimit calls below. It used to
  // run unconditionally here, which charged an LLM token for EVERY convert,
  // including .txt/.md files that go through the regex/passthrough formatter
  // (no LLM) and content-cache hits (no LLM). A batch of N text interviews
  // thus burned N of the 30/min per-user budget doing zero LLM work, starving
  // the follow-up /api/interviews/index call (1 LLM call for embeddings) — it
  // 429'd at its own rate gate before flipping index_status off 'pending', so
  // the whole batch failed to index ("인덱싱 실패", 0 documents landed). Charging
  // only real LLM usage frees the budget for index and the app's other LLM
  // features. Abuse of the pure-extraction path stays bounded by the credit
  // spend (spendCredits) below.

  // Two intake paths:
  //  · JSON { storage_key, filename, mime } — the DIRECT-UPLOAD path
  //    (pr-iv-upload-direct-storage). Bytes are already in Storage (browser →
  //    TUS), so nothing here hit the Vercel 4.5MB body cap. We download the
  //    object back and run the exact same pipeline on it.
  //  · multipart/form-data { file } — the LEGACY path, still used by the
  //    interview-job-provider convert loop and any pre-deploy client. Kept for
  //    backward compat; small files (< 4.5MB) work through it unchanged.
  let file: File;
  let projectId: string | null = null;
  // Object key to delete once convert fully succeeds (direct-upload scratch).
  // Left in place on failure so a client 429-retry can re-download it.
  let cleanupKey: string | null = null;

  if (isJsonIntake) {
    const body = jsonBody;
    const storageKey =
      typeof body?.storage_key === 'string' ? body.storage_key : '';
    const filename =
      typeof body?.filename === 'string' && body.filename
        ? body.filename
        : 'upload';
    const mime = typeof body?.mime === 'string' ? body.mime : '';
    if (!storageKey) {
      logConvertFail({ name: filename, stage: 'validate', reason: 'no_storage_key', status: 400 });
      return NextResponse.json({ error: 'no_storage_key' }, { status: 400 });
    }
    // The key must live under this user's prefix (mirrors the bucket RLS). A
    // client can only ever have uploaded to `<userId>/…` via upload-url, so a
    // mismatch means a forged/foreign key — refuse to read it.
    if (!storageKey.startsWith(`${userId}/`)) {
      logConvertFail({ name: filename, stage: 'validate', reason: 'forbidden_key', status: 403 });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    projectId =
      typeof body?.project_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.project_id)
        ? body.project_id
        : null;
    const { data: blob, error: dlErr } = await db.storage
      .from(UPLOAD_BUCKET)
      .download(storageKey);
    if (dlErr || !blob) {
      logConvertFail({ name: filename, stage: 'download', reason: dlErr?.message ?? 'download_failed', status: 502 });
      return NextResponse.json({ error: 'download_failed' }, { status: 502 });
    }
    cleanupKey = storageKey;
    const buf = await blob.arrayBuffer();
    file = new File([buf], filename, {
      type: mime || blob.type || 'application/octet-stream',
    });
  } else {
    const formData = await request.formData();
    const f = formData.get('file');
    if (!(f instanceof File)) {
      logConvertFail({ name: 'unknown', stage: 'validate', reason: 'no_file', status: 400 });
      return NextResponse.json({ error: 'no_file' }, { status: 400 });
    }
    file = f;
    // Optional active project id from the client. Used so the resulting
    // generations row joins the workspace panel's default 'active' scope.
    // Ignored if not a valid uuid.
    const projectIdRaw = formData.get('project_id');
    projectId =
      typeof projectIdRaw === 'string' && /^[0-9a-f-]{36}$/i.test(projectIdRaw)
        ? projectIdRaw
        : null;
  }

  // Best-effort removal of the direct-upload scratch object once we're done
  // with it. Called only on the success path (below) so retryable failures can
  // re-download; a helper keeps the single call-site tidy.
  const cleanupUpload = async () => {
    if (!cleanupKey) return;
    try {
      await db.storage.from(UPLOAD_BUCKET).remove([cleanupKey]);
    } catch {
      // orphaned scratch object — harmless, storage lifecycle can reclaim it
    }
  };

  // Server-side size validation now actually bites: with direct upload the
  // 4.5–25MB dead-zone (announced-allowed but always edge-413'd) is gone, so
  // this is the single real 25MB gate for both paths.
  if (file.size > MAX_BYTES) {
    logConvertFail({ name: file.name, stage: 'validate', reason: 'file_too_large', status: 413 });
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (file.size === 0) {
    logConvertFail({ name: file.name, stage: 'validate', reason: 'empty_file', status: 400 });
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }

  // Pre-flight balance check — otherwise the user can burn an OpenAI
  // transcription / Anthropic format call and only then learn they're
  // short on credits. Trial / unlimited orgs skip the check (the RPC
  // gives them delta=0 charges).
  const status = internal
    ? await getCreditsStatusAdmin(orgId)
    : await getCreditsStatus(orgId);
  if (
    !status.isUnlimited &&
    !status.isTrialActive &&
    status.balance < FEATURE_COSTS.quotes
  ) {
    logConvertFail({ name: file.name, stage: 'preflight', reason: 'insufficient', status: 402 });
    return NextResponse.json({ error: 'insufficient' }, { status: 402 });
  }

  // Content-addressed cache check. Same bytes = same markdown, regardless
  // of who uploads it. Bump CACHE_V if SYSTEM prompt or output shape changes.
  const CACHE_V = 'v5';
  const fileBuffer = await file.arrayBuffer();
  const fileHash = hashBytes(fileBuffer);
  const cacheKey = `interviews:convert:${CACHE_V}:${fileHash}`;
  const cached = await getCache<{
    markdown: string;
    format_path: 'regex' | 'llm';
    input_chars: number;
    output_chars: number;
  }>(cacheKey);
  if (cached) {
    await cleanupUpload();
    return NextResponse.json({
      ...cached,
      filename: file.name,
      cached: true,
    });
  }

  // Lazy OpenAI client — only built when the path actually needs it
  // (audio/video transcription, or LLM markdown fallback).
  let _openai: OpenAI | null = null;
  function getOpenAI(): OpenAI {
    if (_openai) return _openai;
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('missing_openai_key');
    _openai = new OpenAI({ apiKey });
    return _openai;
  }

  let rawText = '';
  let stage = 'classify';
  try {
    const kind = classifyFile(file);
    if (kind === 'audio' || kind === 'video') {
      stage = 'transcribe';
      // Real LLM work (OpenAI transcription) — apply the LLM rate limit here.
      const limited = await checkLlmRateLimit(userId, orgId);
      if (limited) {
        logConvertFail({ name: file.name, stage, reason: 'rate_limited', status: 429 });
        return limited;
      }
      // Re-wrap the buffered bytes since we already consumed file.arrayBuffer()
      // for hashing — the original File instance is still usable but reading
      // its body twice would re-stream. Build a fresh File from the buffer.
      const audioFile = new File([fileBuffer], file.name, {
        type: file.type || 'application/octet-stream',
      });
      const tx = await getOpenAI().audio.transcriptions.create({
        file: audioFile,
        model: 'gpt-4o-mini-transcribe',
        response_format: 'text',
      });
      rawText = typeof tx === 'string' ? tx : (tx as { text?: string }).text ?? '';
    } else if (kind === 'unsupported') {
      logConvertFail({ name: file.name, stage: 'classify', reason: 'unsupported_file_type', status: 415 });
      return NextResponse.json(
        { error: 'unsupported_file_type', mime: file.type, name: file.name },
        { status: 415 },
      );
    } else {
      stage = `extract_${kind}`;
      // Same trick — feed the already-buffered bytes back as a File so
      // extractDocText doesn't try to drain a stream we already consumed.
      const docFile = new File([fileBuffer], file.name, {
        type: file.type || 'application/octet-stream',
      });
      rawText = await extractDocText(docFile);
    }
    if (!rawText.trim()) {
      logConvertFail({ name: file.name, stage, reason: 'no_text_extracted', status: 422 });
      return NextResponse.json(
        { error: 'no_text_extracted', stage, name: file.name },
        { status: 422 },
      );
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error('extraction_failed');
    logConvertFail({ name: file.name, stage, reason: err.message, status: 502 });
    // 중앙 관측: 파일 추출 실패(502)는 서버측 진짜 실패 — 로그 기록과 병행 적재.
    // rate_limited(429)·no_text(422) 같은 기대/사용자 오류는 제외(코스 저노이즈).
    await logError({
      feature: 'interview',
      code: 'convert_extract_failed',
      message: err.message,
      context: { stage, mime: file.type, org_id: orgId, internal },
    });
    return NextResponse.json(
      { error: err.message, stage, name: file.name, mime: file.type },
      { status: 502 },
    );
  }

  // Format raw transcript into structured Markdown.
  // Path 1 (regex): consistent speaker labels (M:/R:, Q:/A:, 진행자:/응답자:).
  // Path 2 (passthrough): extracted text already has structure (headers,
  //   lists, paragraph breaks, or code fences). No LLM call → no output-
  //   token cap → no silent truncation. Covers most user-uploaded .md and
  //   .docx interviews where each speaker line is its own paragraph.
  // Path 3 (llm): unstructured transcripts (Whisper output, free-form
  //   notes). Anthropic Sonnet 4.6 with explicit maxOutputTokens=16k.
  // Path 4 (raw fallback): if Sonnet fails (rate limit, network, etc.),
  //   fall through to raw text rather than 502'ing the whole request.
  //   Better to give the user the unformatted markdown + low-retention
  //   warning than to lose the conversion entirely.
  let markdown: string;
  let formatPath: 'regex' | 'llm' = 'regex';
  const regexMd = tryRegexMarkdown(rawText, file.name);
  const passthroughMd = regexMd ? null : tryMarkdownPassthrough(rawText, file.name);
  if (regexMd) {
    markdown = regexMd;
  } else if (passthroughMd) {
    markdown = passthroughMd;
  } else {
    formatPath = 'llm';
    const anthropicKey = env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      // No LLM available → degrade to raw text rather than blocking upload.
      console.warn('[interviews/convert] no anthropic key, using raw fallback', file.name);
      markdown = `---\nfile: ${file.name}\n---\n\n${rawText.replace(/\r\n?/g, '\n').trim()}\n`;
    } else {
      // Real LLM work (Sonnet markdown formatting) — apply the LLM rate limit
      // here, only on the unstructured-transcript path that actually calls it.
      // No DB writes have happened yet, so returning 429 is clean and the
      // client's retry-after backoff drains it.
      const limited = await checkLlmRateLimit(userId, orgId);
      if (limited) {
        logConvertFail({ name: file.name, stage: 'format', reason: 'rate_limited', status: 429 });
        return limited;
      }
      try {
        const anthropic = createAnthropic({ apiKey: anthropicKey });
        const rawTextSan = await sanitizeUserInput(rawText, 'raw_transcript', {
          endpoint: '/api/interviews/convert',
          user_id: userId,
          org_id: orgId,
          actor_email: actorEmail,
          input_length: rawText.length,
          input_label: 'raw_transcript',
        });
        const result = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: SYSTEM,
          prompt: `파일명: ${file.name}\n\n원문 인터뷰 텍스트:\n\n${rawTextSan.wrapped}`,
          temperature: 0.2,
          maxOutputTokens: 16384,
          providerOptions: ZERO_RETENTION,
        });
        markdown = result.text.trim() || rawText;
      } catch (e) {
        // Common case: Anthropic per-minute rate limit on big inputs.
        // Don't 502 — the downstream extract step is willing to work on
        // raw text. The retention badge already flags low retention; here
        // we keep retention high by skipping the formatter entirely.
        const msg = e instanceof Error ? e.message : 'format_failed';
        console.warn('[interviews/convert] llm format failed, raw fallback:', file.name, msg);
        markdown = `---\nfile: ${file.name}\nformat_fallback: raw\nformat_error: ${msg.replace(/\n/g, ' ').slice(0, 200)}\n---\n\n${rawText.replace(/\r\n?/g, '\n').trim()}\n`;
      }
    }
  }

  const { data: gen, error: insertErr } = await db
    .from('generations')
    .insert({
      org_id: orgId,
      user_id: userId,
      feature: 'quotes',
      input: file.name,
      output: markdown,
      credits_spent: FEATURE_COSTS.quotes,
      project_id: projectId,
    })
    .select('id')
    .single();

  if (insertErr || !gen) {
    logConvertFail({ name: file.name, stage: 'persist', reason: insertErr?.message ?? 'db_error', status: 500 });
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  // 차감 — 체인 경로도 **같은 지점·같은 금액**으로 발화한다. 세션이 없어
  // auth.uid() 기반 RPC 를 못 쓰므로 행위자를 명시 전달하는 admin 변종을 쓴다
  // (감사 추적은 credit_transactions 에 동일하게 남는다).
  const spend = internal
    ? await spendCreditsAdmin(orgId, userId, 'quotes', gen.id)
    : await spendCredits(orgId, 'quotes', gen.id);
  if (!spend.ok) {
    await db.from('generations').delete().eq('id', gen.id);
    logConvertFail({ name: file.name, stage: 'spend', reason: spend.reason, status: 402 });
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  // Write the result into the content-addressed cache so future uploads
  // of the same bytes skip transcription / LLM formatting entirely.
  await setCache(cacheKey, {
    markdown,
    format_path: formatPath,
    input_chars: rawText.length,
    output_chars: markdown.length,
  });

  // Convert succeeded and the result is cached — drop the direct-upload scratch
  // object (no-op for the legacy multipart path).
  await cleanupUpload();

  return NextResponse.json({
    markdown,
    filename: file.name,
    generation_id: gen.id,
    format_path: formatPath,
    input_chars: rawText.length,
    output_chars: markdown.length,
    cached: false,
  });
}
