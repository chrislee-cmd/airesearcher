// POST /api/scheduling/public/[token]/verify
//   { tail } → candidate.phone 뒷자리와 대조. 통과 시 token-바인딩 서명 쿠키 발급.
//
// recruiting-scheduling 참여자 진입 게이트(뒷자리 2차 인증). participant_token 은
// 후보자 1명 스코프(665)라 서버 격리는 이미 되어 있지만, 링크만 있으면 누구나
// 그 후보자 것을 본다 — 이 라우트가 "본인(전화 뒷자리 소지)"만 통과시킨다.
//
// 🔒 방어:
//   * 뒷자리 대조·candidate 도출 전부 서버(service-role). 클라 신뢰 X.
//   * 시크릿이 6자리(100만 조합)라 rate-limit + lockout(token:ip) 이 실질 방어.
//   * 실패/무효 토큰 모두 동일한 generic 401 — 후보자 존재/전화 등록 여부 미노출.
//   * 발급 쿠키는 httpOnly + Secure + token 바인딩(다른 링크 재사용 불가).
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveSchedToken } from '@/lib/scheduling/public';
import {
  phoneTailMatches,
  signParticipantGate,
  participantGateCookieName,
  PARTICIPANT_GATE_TTL_MIN,
} from '@/lib/scheduling/participant-gate';
import {
  rateLimitMany,
  rateLimitResponse,
  getClientIp,
  LIMITS,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Generic verdict — deliberately never distinguishes "token not found",
// "no phone on file", or "wrong tail" so a probe learns nothing.
function invalid() {
  return NextResponse.json({ error: 'invalid' }, { status: 401 });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

  // Throttle BEFORE any DB work — the tail is a weak secret, so the limiter is
  // the primary defense. Keyed by (token:ip): a leaked link + single IP can't
  // sweep the 10k combo space (5/min, 20/hour lockout).
  const ip = getClientIp(request);
  const key = `${token}:${ip}`;
  const rl = await rateLimitMany([
    {
      identifier: key,
      prefix: 'sched-gate',
      limit: LIMITS.schedGate.limit,
      window: LIMITS.schedGate.window,
    },
    {
      identifier: key,
      prefix: 'sched-gate-h',
      limit: LIMITS.schedGateHourly.limit,
      window: LIMITS.schedGateHourly.window,
    },
  ]);
  if (!rl.success) {
    console.warn('[sched-gate] rate limited', {
      token: token.slice(0, 8),
      ip,
      retryAfter: rl.retryAfter,
    });
    return rateLimitResponse(rl);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid();
  }
  const tail =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).tail
      : undefined;
  if (typeof tail !== 'string') return invalid();

  const gate = await resolveSchedToken(token);
  // Dead/invalid token → same generic 401 as a wrong tail (no existence leak).
  if ('error' in gate) return invalid();

  if (!phoneTailMatches(gate.candidate.phone, tail)) {
    console.warn('[sched-gate] failed attempt', {
      token: token.slice(0, 8),
      ip,
    });
    return invalid();
  }

  // Passed — issue the short-lived, token-bound signed cookie. The page + data
  // routes re-check this cookie server-side before rendering/returning data.
  const cookieStore = await cookies();
  cookieStore.set(participantGateCookieName(token), signParticipantGate(token), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: PARTICIPANT_GATE_TTL_MIN * 60,
  });

  return NextResponse.json({ ok: true });
}
