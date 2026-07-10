// 프로빙 어시스턴트 — transcription-only Realtime session.
//
// translate-console 이 `gpt-realtime-translate` (translation 모델) 위에서
// host transcript 를 부산물로 받는 것과 달리, probing 위젯은 transcript
// 자체가 출발점이라 OpenAI 의 dedicated transcription session API 를 쓴다.
// 세션은 단방향 (audio in → text out), translation/TTS 트랙 없음.
//
// 응답: { model, client_secret: { value, expires_at } }. 클라이언트는
// value 를 들고 `https://api.openai.com/v1/realtime?intent=transcription`
// 으로 SDP 교환만 수행. translate sessions/route 와 의도적으로 같은
// shape — 다만 LiveKit / DB row 는 필요 없다 (위젯이 휘발성).

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/env';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Unified Realtime client_secrets endpoint. transcription-only 세션은
// body 의 `session.type = 'transcription'` + `audio.input.transcription`
// 으로 표현. 이전 `/v1/realtime/transcription_sessions` 는 deprecated (404).
const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const DEFAULT_TTL_SECONDS = 600;

// Well-formed UUID guard for the optional renewal `session_id`. Anything else
// is ignored and treated as a fresh session (new start-lump).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
  }

  // Probing session id is server-generated; doubles as the `generation_id`
  // for the start-lump credit charge so retries (network re-POST) collapse
  // to a single billed start via the partial UNIQUE on
  // credit_transactions(generation_id) WHERE reason='feature_use'. The
  // heartbeat route derives subsequent tick generation_ids deterministically
  // from this same session_id so a session never double-charges itself.
  //
  // Session renewal (client hits the OpenAI ~30-min transcription cap and
  // reconnects mid-session): the client POSTs its original `session_id`. We
  // reuse it as the generation_id, so spend_credits short-circuits on the
  // existing feature_use row (0021 migration) and returns ok WITHOUT charging
  // again — the time-based billing is already covered by the original
  // start-lump + heartbeat ticks. A forged / unknown session_id has no prior
  // charge, so it just bills a normal start-lump (no free session).
  const reqBody = (await req.json().catch(() => ({}))) as {
    session_id?: unknown;
    source?: unknown;
  };
  const renewId =
    typeof reqBody?.session_id === 'string' && UUID_RE.test(reqBody.session_id)
      ? reqBody.session_id
      : null;
  const sessionId = renewId ?? randomUUID();
  // 캡처 소스 (mic/tab) — probing_session_runs 계측용. 신규 start 에만 의미.
  const source =
    reqBody?.source === 'mic' || reqBody?.source === 'tab'
      ? reqBody.source
      : null;

  // Charge the start lump *before* allocating the OpenAI client_secret.
  // FEATURE_COSTS.probing = 25 — covers the first hour (one tick).
  // On insufficient balance the OpenAI call is skipped entirely so the
  // user doesn't pay for an OpenAI session they can't actually use.
  // On renewal this is idempotent (no extra charge — see above).
  const spend = await spendCredits(org.org_id, 'probing', sessionId);
  if (!spend.ok) {
    return NextResponse.json(
      { error: spend.reason === 'insufficient' ? 'insufficient_credits' : 'forbidden' },
      { status: 402 },
    );
  }

  const transcriptionModel =
    env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe';

  // turn_detection.server_vad 가 있어야 transcription session 이
  // utterance 경계마다 `*.completed` 이벤트를 emit. 없으면 delta 만
  // 흘러서 final commit 시점을 위젯이 알 수 없다.
  //
  // 통합 세션 schema — `session.type='transcription'` 로 transcription-only
  // 모드 지정. translate-console 이 쓰는 `gpt-realtime-translate` 와 같은
  // `/v1/realtime/client_secrets` 엔드포인트를 공유하지만 type 만 다르다.
  const body = {
    session: {
      type: 'transcription',
      audio: {
        input: {
          transcription: {
            model: transcriptionModel,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      },
    },
  };

  // OpenAI client_secrets 발급 — 명시적 15s 타임아웃. 이게 없으면 OpenAI 가
  // hang 할 때 클라이언트의 8s session-fetch AbortController (훅) 가 먼저
  // 끊고, 서버는 유령 요청을 계속 붙들고 있게 된다. 소요 시간은 아래 timing
  // 로그로 Vercel 함수 로그에서 확인 가능 (느린 응답 진단용, spec D).
  const openaiStartedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    console.warn('[probing/sessions] openai client_secret failed', {
      timeout: timedOut,
      elapsed_ms: Date.now() - openaiStartedAt,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      {
        error: timedOut
          ? 'openai_session_timeout'
          : e instanceof Error
            ? e.message
            : 'openai_unreachable',
      },
      { status: 504 },
    );
  }
  console.info('[probing/sessions] openai client_secret', {
    status: res.status,
    elapsed_ms: Date.now() - openaiStartedAt,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `openai_session_failed_${res.status}`, detail: detail.slice(0, 300) },
      { status: 502 },
    );
  }

  const json = (await res.json().catch(() => ({}))) as {
    client_secret?: { value?: string; expires_at?: number } | string;
    value?: string;
    expires_at?: number;
  };

  // OpenAI 가 응답 shape 을 두 가지로 돌려준 사례가 있어 둘 다 흡수:
  //   1. `{ client_secret: { value, expires_at } }`  (transcription_sessions 기본)
  //   2. `{ client_secret: "<value>", expires_at }`  (일부 beta 변형)
  const cs = json.client_secret;
  const value =
    typeof cs === 'string' ? cs : cs?.value ?? json.value;
  const expires_at =
    typeof cs === 'object' && cs ? cs.expires_at : json.expires_at;
  if (!value || typeof value !== 'string') {
    return NextResponse.json(
      { error: 'openai_session_invalid_response' },
      { status: 502 },
    );
  }

  // 세션 라이프사이클 계측 (OBS-2) — 신규 start 만 'active' run row insert.
  // renewal(같은 session_id 재전송)은 이미 row 가 있으므로 skip. best-effort:
  // 계측 실패가 세션 시작(핵심 경로)을 막지 않는다. row 는 session_id 를 그대로
  // 식별자로 써서 credit_transactions.generation_id 및 #554 녹음과 정합.
  if (!renewId) {
    const { error: runInsertError } = await supabase
      .from('probing_session_runs')
      .insert({
        org_id: org.org_id,
        user_id: user.id,
        session_id: sessionId,
        status: 'active',
        source,
      });
    if (runInsertError) {
      console.warn('[probing/sessions] session_run insert failed', {
        session_id: sessionId,
        error: runInsertError.message,
      });
    }
  }

  return NextResponse.json({
    session_id: sessionId,
    model: transcriptionModel,
    client_secret: {
      value,
      expires_at: expires_at ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS,
    },
  });
}
