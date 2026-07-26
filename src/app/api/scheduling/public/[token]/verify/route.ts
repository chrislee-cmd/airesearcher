// POST /api/scheduling/public/[token]/verify   (token = project share_token)
//   { tail }                → match phone tail against the project's candidates
//   { tail, candidateId }   → confirm a name pick after a tail collision
//   { fullPhone }           → fallback when tail-matches share the same name
//
// recruiting-scheduling 참여자 진입 게이트. 링크는 프로젝트 공통 링크(share_token)
// 라 익명이다 — 이 라우트가 방문자의 전화 뒷 6자리를 프로젝트 후보들과 대조해
// **누구인지**를 확정하고, 그 candidate.id 를 서명 쿠키에 담아 발급한다. 이후
// 데이터/메시지 라우트는 요청 body 가 아니라 그 쿠키의 candidate 로만 스코프한다.
//
// 🔒 방어:
//   * 뒷자리 대조·candidate 도출 전부 서버(service-role). 클라 신뢰 X.
//   * 시크릿이 6자리(100만 조합)라 rate-limit + lockout(shareToken:ip) 이 실질 방어.
//   * 충돌(뒷6 중복) 시 이름 선택 → 재-POST 시 candidateId 가 매칭 집합에 드는지
//     서버가 재확인(임의 candidateId 주입 불가).
//   * 발급 쿠키는 httpOnly + Secure + shareToken/candidate 바인딩(재사용 불가).
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  resolveShareToken,
  listProjectCandidates,
  matchCandidatesByTail,
  matchCandidatesByFullPhone,
  type SchedPublicCandidate,
} from '@/lib/scheduling/public';

type Admin = ReturnType<typeof createAdminClient>;
import {
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

// Generic verdict for a bad request / wrong pick — never distinguishes cases a
// prober could learn from.
function invalid() {
  return NextResponse.json({ error: 'invalid' }, { status: 401 });
}

async function setGateCookie(shareToken: string, candidateId: string) {
  const cookieStore = await cookies();
  cookieStore.set(
    participantGateCookieName(shareToken),
    signParticipantGate(shareToken, candidateId),
    {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: PARTICIPANT_GATE_TTL_MIN * 60,
    },
  );
}

// 합류 확인 스탬프 — 폰게이트를 통과(= 이 링크가 이 사람의 것임이 상호 확인)한
// 순간에만 찍는다. joined_at 은 최초 1회(불변), last_seen_at 은 매번. 이 값이
// 문자 알림 자격의 SSOT(sms-notify.ts). best-effort: 어떤 실패도 게이트 통과를
// 막지 않는다(참가자 화면 우선). 컬럼 미적용(42703) 환경은 조용히 무시.
async function stampJoin(admin: Admin, candidateId: string) {
  try {
    const { data, error } = await admin
      .from('sched_candidates')
      .select('joined_at')
      .eq('id', candidateId)
      .maybeSingle();
    if (error) return; // 컬럼 미적용 등 — best-effort skip
    const now = new Date().toISOString();
    const patch: Record<string, string> = { last_seen_at: now };
    // 최초 통과일 때만 joined_at 세팅(이후 재접속에도 불변).
    if (data && !(data as { joined_at: string | null }).joined_at) {
      patch.joined_at = now;
    }
    await admin.from('sched_candidates').update(patch).eq('id', candidateId);
  } catch {
    // best-effort — 로그만 남기고 삼킨다.
    console.warn('[sched-gate] stampJoin failed', { candidateId });
  }
}

// 게이트 통과 = 쿠키 발급 + 합류 스탬프. 두 성공 경로(고유 매칭·이름/전화 확정)가
// 공유한다 — 스탬프 지점을 한 곳으로 모아 누락을 막는다.
async function letIn(admin: Admin, shareToken: string, candidateId: string) {
  await stampJoin(admin, candidateId);
  await setGateCookie(shareToken, candidateId);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;

  // Throttle BEFORE any DB work — the tail is a weak secret, so the limiter is
  // the primary defense. Keyed by (shareToken:ip): a leaked link + single IP
  // can't sweep the 10^6 combo space (5/min, 20/hour lockout).
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
  const b = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const tail = typeof b.tail === 'string' ? b.tail : undefined;
  const candidateId = typeof b.candidateId === 'string' ? b.candidateId : undefined;
  const fullPhone = typeof b.fullPhone === 'string' ? b.fullPhone : undefined;

  const resolved = await resolveShareToken(token);
  // Dead/invalid link → same generic 401 (no existence leak).
  if ('error' in resolved) return invalid();
  const { admin, project } = resolved;
  const candidates = await listProjectCandidates(admin, project.id);

  // ── Full-phone fallback (name collision) ──────────────────────────────────
  if (fullPhone !== undefined) {
    const matches = matchCandidatesByFullPhone(candidates, fullPhone);
    if (matches.length === 1) {
      await letIn(admin, token, matches[0].id);
      return NextResponse.json({ ok: true });
    }
    // 0 or (truly identical) 2+ → can't identify.
    return NextResponse.json({ error: 'no_match' }, { status: 404 });
  }

  if (typeof tail !== 'string') return invalid();
  const matches = matchCandidatesByTail(candidates, tail);

  // No candidate in this project ends with these 6 digits (includes no-phone
  // candidates, who never match) → nobody to let in.
  if (matches.length === 0) {
    console.warn('[sched-gate] no match', { token: token.slice(0, 8), ip });
    return NextResponse.json({ error: 'no_match' }, { status: 404 });
  }

  // ── Disambiguation confirm — a name was picked after a collision ──────────
  if (candidateId !== undefined) {
    const chosen = matches.find((c) => c.id === candidateId);
    // The chosen id MUST be one that actually matches the tail (re-checked
    // server-side) — a visitor can't inject an arbitrary candidate id.
    if (!chosen) return invalid();
    await letIn(admin, token, chosen.id);
    return NextResponse.json({ ok: true });
  }

  // Unique match → straight through.
  if (matches.length === 1) {
    await letIn(admin, token, matches[0].id);
    return NextResponse.json({ ok: true });
  }

  // ── Tail collision (2+) → disambiguate ────────────────────────────────────
  // Prefer a name pick. If names can't tell them apart (blank or duplicated),
  // fall back to asking for the full phone number.
  if (namesAreDistinct(matches)) {
    return NextResponse.json({
      collision: true,
      candidates: matches.map((c) => ({ id: c.id, name: c.name })),
    });
  }
  return NextResponse.json({ collision: true, needFullPhone: true });
}

// Names distinguish the matches only if every candidate has a non-blank name
// and no two are identical (case/space-insensitive).
function namesAreDistinct(candidates: SchedPublicCandidate[]): boolean {
  const seen = new Set<string>();
  for (const c of candidates) {
    const norm = (c.name ?? '').trim().toLowerCase();
    if (!norm || seen.has(norm)) return false;
    seen.add(norm);
  }
  return true;
}
