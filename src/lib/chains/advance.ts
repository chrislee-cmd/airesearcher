import { env } from '@/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeploymentBaseUrl } from '@/lib/transcripts/dispatch';
import { logError } from '@/lib/observability/log-error';
import {
  kickInterviewIngestFromTranscript,
  kickTranscriptFromProbingRecording,
  recordStepFailure,
  recordStepJobRef,
  type AdapterResult,
} from './adapters';
import {
  casChain,
  pickChainForStepEvent,
  planStepAdvance,
  type ChainRow,
  type ChainStepEventMatch,
} from './state';
import type { ChainStepKey } from './registry';

// 위젯 연쇄 체인 — advance 훅 (PR-B).
//
// 각 파이프라인이 "단계 done 을 확정"하는 서버 지점에서 이 모듈을 부른다.
// 하는 일: 활성 체인 조회 → 현재 단계 done 마킹(멱등 CAS) → 모드 분기
// (approve 면 승인 대기 전이만, auto 면 다음 단계 즉시 kick).
//
// **채택(adoption) 대상 = running + 조립 완료(awaiting_approval) 둘 다** (B′).
// 후자는 "도킹 레인에서 조립만 해 두고 승인 모달 없이 진입 위젯 세션을 그냥
// 돌린" 경우이고, approve 가 기본 모드라 **그게 기본 경로**다. 자세한 근거와
// 경합 판별은 findChainAtStep · state.planStepAdvance 주석 참고.
//
// ══════════════════════════════════════════════════════════════════════════
// ⚠️ #1024 불변식 — 활성 체인이 없으면 **어떤 자동 동작도 없다**
// ══════════════════════════════════════════════════════════════════════════
// 인덱싱 → 탑라인 자동 kick 은 2026-07-13 #1024 로 **의도 제거**된 것이다
// (원치 않는 Opus 자동 과금 + 강제 진입). 그 자동화를 되살리는 유일한 조건은
// "사용자가 체인을 명시 생성했고 모드를 선택했다" 뿐이다.
//
// 따라서 `advanceChain` 의 첫 동작은 활성 체인 조회이고, 없으면 **즉시
// no-op 으로 반환**한다 — DB 쓰기 0, 외부 호출 0, 과금 0. 체인을 만들지 않은
// 사용자의 전사/프로빙/인덱싱 잡은 이 훅이 걸려 있다는 사실조차 관측할 수
// 없어야 한다. 호출 지점 6곳 전부 이 불변식 위에 서 있다.
// ══════════════════════════════════════════════════════════════════════════
//
// 이 모듈이 소유하는 것 / 소유하지 않는 것:
//   - 소유: 체인 레벨 status 전이(running/awaiting_approval/paused/done/error),
//           커서 이동, 모드 분기, kick 디스패치.
//   - 비소유: 단계 간 데이터 이송(= C 의 어댑터), steps[].job_ref/error 기록
//           (= 어댑터의 recordStep* 헬퍼), 단계 **재시도**.
//
// 재시도 금지(리스크 R4): 단계 실패의 재시도는 각 파이프라인의 기존 sweep
// (index-resume-sweep · topline-resume-sweep · transcript-reconcile)이 소유한다.
// 체인이 자체 재시도를 하면 이중 재시도 경합이 된다. 체인이 하는 유일한 회수는
// `/api/cron/chain-sweep` — 24h 정체된 체인을 **닫는 것**(재시도 아님)이다.
//
// ⚠️ 서버 전용(서비스롤 + CRON_SECRET). 클라이언트에서 import 금지.

type AdminClient = ReturnType<typeof createAdminClient>;

const CHAINS_TABLE = 'widget_chains';

// 한 org 에서 동시에 활성일 수 있는 체인 수는 "프로젝트당 1" 제약으로 실질
// 소수다. 후보를 넉넉히 받아 메모리에서 단계 매칭한다(steps 는 jsonb 라 서버
// 사이드 인덱스 매칭이 불가 — current_step 번째 원소를 봐야 한다).
const CANDIDATE_LIMIT = 20;

/**
 * 레지스트리 단계 key — 훅 호출부가 오타로 엉뚱한 feature 를 넘기지 못하게.
 * 레지스트리(CHAIN_STEPS)에서 파생한다 — 손으로 베낀 union 은 노드가 추가될 때
 * 조용히 어긋난다(노드 집합의 SSOT 는 registry 하나).
 */
export type ChainSourceFeature = ChainStepKey;

/**
 * kick 결과 요약.
 *   kicked   — 다음 단계 job 을 실제로 착수했다.
 *   manual   — 서버가 kick 할 것이 없는 사용자 주도 단계(진입 단계 등). 체인은
 *              running 으로 남아 그 단계의 done 훅을 기다린다.
 *   done     — 마지막 단계를 착수해 체인 오케스트레이션이 끝났다.
 *   paused   — 크레딧 부족(402) → paused_insufficient_credits.
 *   retry    — 일시적 사유(아직 준비 안 됨). 체인은 running 유지 + 사유 기록.
 *   error    — 영구 실패 → 체인 error.
 */
export type KickOutcome =
  | 'kicked'
  | 'manual'
  | 'done'
  | 'paused'
  | 'retry'
  | 'error';

export type AdvanceResult =
  | { advanced: false; reason: 'no_chain' | 'ambiguous' | 'conflict' }
  | { advanced: true; chainId: string; outcome: 'awaiting_approval' | KickOutcome };

/**
 * 이 완료 이벤트가 전진시켜야 할 활성 체인을 찾는다. 없으면 matched:false(= no-op).
 *
 * DB 에서 후보를 넉넉히 읽고, **어느 체인인지 고르는 판정은 순수 함수**
 * (`pickChainForStepEvent`, state.ts)에 맡긴다 — 매칭 경계를 단위 테스트로
 * 고정하기 위해서다(이 모듈은 server-only import 때문에 `tests/` 가 로드하지
 * 못한다).
 *
 * 후보 status 가 두 개인 이유(B′):
 *   - `running` — 기존 경로. 체인이 kick 한 단계(exact) 또는 가변 진입점으로
 *     사용자가 직접 돌린 단계(adopt_running).
 *   - `awaiting_approval` — **조립만 끝내고 아직 아무것도 시작하지 않은**
 *     approve 체인(커서 0 · job_ref 전무). 도킹 레인은 레인이 유효해지는 순간
 *     체인을 POST 하므로, 사용자가 승인 모달을 거치지 않고 진입 위젯 세션을
 *     그냥 돌려 끝내는 것이 **기본 경로**다. 이 체인을 채택하지 않으면 "세션이
 *     끝나면 시작"(CD L3→L4)이 성립하지 않는다. v1/v2 는 "생성 직후 자동 승인"
 *     으로 이 틈을 메웠지만, 그건 조립을 즉시 잠가 카드 수정(A″)을 불능으로
 *     만든다 — 그래서 승인이 아니라 **채택**으로 푼다.
 */
async function findChainAtStep(
  admin: AdminClient,
  args: {
    orgId: string;
    projectId?: string | null;
    sourceFeature: ChainSourceFeature;
    jobRef: string;
  },
): Promise<ChainStepEventMatch> {
  const { data, error } = await admin
    .from(CHAINS_TABLE)
    .select('*')
    .eq('org_id', args.orgId)
    .in('status', ['running', 'awaiting_approval'])
    .order('updated_at', { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (error) throw error;

  return pickChainForStepEvent((data ?? []) as ChainRow[], {
    projectId: args.projectId,
    sourceFeature: args.sourceFeature,
    jobRef: args.jobRef,
  });
}

/**
 * 단계 완료를 체인에 반영하고 다음 단계로 전진시킨다.
 *
 * **활성 체인이 없으면 즉시 no-op** (#1024 불변식 — 이 파일 상단 참고).
 *
 * @param sourceFeature 방금 완료된 단계의 레지스트리 key.
 * @param jobRef 완료된 위젯 job id(전사 job / 프로빙 세션 / 인터뷰 job).
 */
export async function advanceChain(args: {
  orgId: string;
  projectId?: string | null;
  sourceFeature: ChainSourceFeature;
  jobRef: string;
  admin?: AdminClient;
}): Promise<AdvanceResult> {
  const admin = args.admin ?? createAdminClient();

  const match = await findChainAtStep(admin, args);
  if (!match.matched) {
    if (match.reason === 'ambiguous') {
      console.warn(
        '[chains/advance] ambiguous chain match — skipped',
        args.sourceFeature,
        args.jobRef,
      );
      return { advanced: false, reason: 'ambiguous' };
    }
    // 체인 없음 = 평소의 위젯 사용. 아무 일도 일어나지 않는다(#1024).
    return { advanced: false, reason: 'no_chain' };
  }
  const chain = match.row;

  // 전이 계획(순수) — 완료 단계 done 마킹 · 다음 단계 활성화 · CAS 술어 선택.
  // 조립 채택(adopt_assembly)이면 expectedStatus='awaiting_approval' +
  // updated_at 낙관적 토큰이 들어온다(조립 수정 PATCH 와의 선후 판별).
  const plan = planStepAdvance(chain, args.jobRef);
  const res = await casChain(
    admin,
    chain.id,
    plan.expectedStatus,
    plan.patch,
    plan.expectedCurrentStep,
    plan.expectedUpdatedAt,
  );
  if (!res.applied) {
    // 경합에서 졌다 — 다른 done 이벤트가 먼저 전진시켰거나(멱등), 조립 채택
    // 이라면 그 사이 PATCH/승인/종료가 행을 건드렸다. 어느 쪽이든 no-op:
    // 사용자가 갱신된 조립으로 다시 세션을 돌리는 것이 정상 경로다.
    return { advanced: false, reason: 'conflict' };
  }

  if (plan.nextIndex === null) {
    return { advanced: true, chainId: chain.id, outcome: 'done' };
  }
  if (plan.nextStatus !== 'running') {
    // approve 모드 — 다음 단계는 승인 게이트. kick 은 승인 라우트의 몫.
    return { advanced: true, chainId: chain.id, outcome: 'awaiting_approval' };
  }

  const outcome = await kickCurrentStep(admin, res.row);
  return { advanced: true, chainId: chain.id, outcome };
}

/**
 * 체인의 **현재 단계**를 실제로 착수한다. auto 모드의 advance 가 전진 직후
 * 부르고, approve 모드는 승인 라우트가 전이 직후 부른다(= A 의 kick 스텁 대체).
 *
 * 호출 전제: 체인 status='running' 이고 current_step 의 단계가 러너블.
 * 반환 전에 체인 레벨 status(paused/error/done) 전이까지 마친다.
 */
export async function kickCurrentStep(
  admin: AdminClient,
  chain: ChainRow,
): Promise<KickOutcome> {
  const index = chain.current_step;
  const step = chain.steps?.[index];
  if (!step) {
    await markChainError(admin, chain, `invalid_cursor: ${index}`);
    return 'error';
  }
  const prev = index > 0 ? chain.steps[index - 1] : null;
  const isLast = index === chain.steps.length - 1;

  let result: AdapterResult;
  switch (step.feature) {
    case 'probing':
      // 프로빙 세션은 사용자가 UI 에서 직접 진행한다 — 서버가 kick 할 것이 없다.
      return 'manual';

    case 'transcripts': {
      // 직전 단계(프로빙)의 job_ref = 종료된 세션 id. 없으면 이 단계가 체인의
      // 진입 단계 → 사용자가 직접 업로드하므로 kick 하지 않는다.
      const sessionId =
        prev?.feature === 'probing' ? (prev.job_ref ?? null) : null;
      if (!sessionId) return 'manual';
      result = await kickTranscriptFromProbingRecording({
        chain,
        stepIndex: index,
        sessionId,
        admin,
      });
      break;
    }

    case 'interview_ingest': {
      const transcriptJobId =
        prev?.feature === 'transcripts' ? (prev.job_ref ?? null) : null;
      if (!transcriptJobId) return 'manual';
      result = await kickInterviewIngestFromTranscript({
        chain,
        stepIndex: index,
        transcriptJobId,
        admin,
      });
      break;
    }

    case 'topline':
      result = await kickTopline(admin, chain, index);
      break;

    default: {
      // 레지스트리에 없는 단계 — 템플릿과 kick 디스패치가 어긋났다는 뜻이다.
      // 조용히 넘기지 않고 단계·체인 양쪽에 사유를 남긴다.
      const reason = `unknown_step: ${step.feature}`;
      await recordStepFailure(admin, chain.id, index, reason);
      result = { ok: false, reason };
      break;
    }
  }

  if (result.ok) {
    if (isLast) {
      // 마지막 단계를 착수한 시점에 체인의 오케스트레이션은 끝났다. 착수한
      // 위젯 자체의 완료는 그 위젯의 status 와 watchdog(topline-resume-sweep
      // 등)이 소유한다 — 체인을 running 으로 남겨 두면 정상 성공인데도
      // chain-sweep 이 24h 뒤 error 로 닫아 버린다(거짓 실패). steps[] 는
      // 사실대로 running + job_ref 를 유지하고 체인만 done 으로 닫는다.
      const res = await casChain(
        admin,
        chain.id,
        'running',
        { status: 'done' },
        index,
      );
      return res.applied ? 'done' : 'kicked';
    }
    return 'kicked';
  }

  if (result.insufficientCredits) {
    // 조용한 실패 금지(R9 · #1319) — 멈춘 사유를 체인에 남겨 UI 가 표면화한다.
    await casChain(
      admin,
      chain.id,
      'running',
      {
        status: 'paused_insufficient_credits',
        error_message: result.reason.slice(0, 500),
      },
      index,
    );
    return 'paused';
  }

  if (result.retryable) {
    // 영구 실패가 아니다(녹음 업로드 진행 중 등). 체인을 error 로 굳히지 않고
    // 사유만 남긴다 — 단계 재시도는 체인의 몫이 아니므로(R4) 여기서 다시
    // 시도하지 않는다. 해소되지 않으면 chain-sweep 이 24h 뒤 닫는다.
    await admin
      .from(CHAINS_TABLE)
      .update({ error_message: result.reason.slice(0, 500) })
      .eq('id', chain.id)
      .eq('status', 'running')
      .eq('current_step', index);
    return 'retry';
  }

  await markChainError(admin, chain, result.reason);
  return 'error';
}

// 체인을 error 로 종결 + 사유 보존. CAS 라 동시 cancel/approve 와 경합해도 안전.
async function markChainError(
  admin: AdminClient,
  chain: ChainRow,
  reason: string,
): Promise<void> {
  await casChain(
    admin,
    chain.id,
    'running',
    { status: 'error', error_message: reason.slice(0, 500) },
    chain.current_step,
  );
  await logError({
    feature: 'interview',
    code: 'chain_step_failed',
    message: reason,
    context: {
      chain_id: chain.id,
      org_id: chain.org_id,
      step: chain.current_step,
      feature: chain.steps?.[chain.current_step]?.feature ?? null,
    },
  });
}

/**
 * 탑라인 단계 kick — **기존 `POST /api/interviews/v2/topline` 을 그대로 재사용**
 * 한다. 신규 생성 경로를 만들지 않는 이유: 캐시(content_hash 동일 → LLM 0)·
 * stale 판정·인덱싱 완전성 게이트(#681)·rate-limit 이 전부 그 라우트에 있다.
 * 우회하면 #1024 가 막은 "원치 않는 Opus 호출"이 뒷문으로 돌아온다.
 *
 * 세션 없는 서버 지점에서 부르므로 쿠키가 없다 → CRON_SECRET Bearer + body 로
 * 행위자/테넌트를 명시 전달하는 내부 경로를 탄다(`/api/interviews/convert` 가
 * C 에서 이미 쓰는 동일 패턴).
 */
async function kickTopline(
  admin: AdminClient,
  chain: ChainRow,
  stepIndex: number,
): Promise<AdapterResult> {
  if (!chain.project_id) {
    // 프로젝트 미귀속 체인은 탑라인에 진입할 수 없다. 사용자가 D(UI)에서
    // 프로젝트를 고르면 해소되므로 영구 실패로 굳히지 않는다(사유 기록은
    // 호출측 retryable 분기가 수행).
    return { ok: false, reason: 'chain_project_required', retryable: true };
  }

  let res: Response;
  try {
    res = await fetch(`${getDeploymentBaseUrl()}/api/interviews/v2/topline`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        project_id: chain.project_id,
        chain_user_id: chain.created_by,
        chain_org_id: chain.org_id,
      }),
      // 라우트는 Opus 생성을 after() 로 미루고 즉시 { status:'generating' } 을
      // 돌려주므로 왕복은 짧다. 상한은 호출측(전사/인덱싱 done 지점) 예산 안.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return {
      ok: false,
      reason: `topline_unreachable: ${e instanceof Error ? e.message : 'fetch_failed'}`,
      retryable: true,
    };
  }

  if (res.status === 402) {
    // 탑라인은 현재 무과금이라 실제로는 안 나지만, 과금 도입 시(pricing 트랙)
    // 자동으로 올바른 경로를 타게 둔다.
    return { ok: false, reason: 'insufficient_credits', insufficientCredits: true };
  }
  const body = (await res.json().catch(() => ({}))) as {
    topline_id?: string;
    error?: string;
  };
  if (res.status === 409) {
    // not_indexed / indexing_incomplete — 아직 근거가 준비되지 않았다.
    return {
      ok: false,
      reason: `topline_not_ready: ${body.error ?? '409'}`,
      retryable: true,
    };
  }
  if (!res.ok || !body.topline_id) {
    return {
      ok: false,
      reason: `topline_failed: ${body.error ?? res.status}`,
    };
  }

  await recordStepJobRef(admin, chain.id, stepIndex, body.topline_id);
  return { ok: true, jobRef: body.topline_id };
}
