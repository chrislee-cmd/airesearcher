import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import { getAdminAnalytics } from '@/lib/admin/analytics';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  parseLayoutOrDefault,
  PUBLIC_STATUS_LAYOUT_KEY,
} from '@/lib/admin/dashboard-layout';
import { StatusWidgetBoard } from '@/components/status-widget-board';
import { AutoRefresh } from '@/components/auto-refresh';
import { env } from '@/env';

/* ────────────────────────────────────────────────────────────────────
   Public read-only metrics view — /[locale]/status?key=<token>.

   Lives OUTSIDE the (app) auth layer, so it renders login-independent
   (always-on wall/phone monitor). The route's existence gate is the secret
   PUBLIC_DASHBOARD_TOKEN, compared in constant time (fail-closed):
     - token env unset            → notFound()
     - ?key missing / wrong / dup → notFound()

   구성형 위젯 보드(카드 #584): 저장된 공유 레이아웃을 service-role 로 조회해
   <StatusWidgetBoard> 로 렌더한다. 편집(드래그/리사이즈/추가·제거/저장)은
   super-admin 세션일 때만 활성(canEdit) — 공개 토큰만 아는 시청자는 read-only.
   즉 토큰 게이트는 "라우트 존재"를, super-admin 세션은 "편집 권한"을 각각 관장한다
   (토큰 게이트를 약화시키지 않음 — chris 도 편집하려면 토큰 URL 로 들어와야 함).

   Data is getAdminAnalytics() ONLY — pre-aggregated counts, no raw rows or
   PII. listAllSignupEmails() (the signup roster) is deliberately NOT imported.
   ⚠️ 누적 결제금액(매출)이 토큰 URL 로 공개됨 — 토큰 게이트가 유일 방어(사용자 명시).
   ──────────────────────────────────────────────────────────────────── */

// Even if the token leaks, keep this out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Constant-time token check. timingSafeEqual throws on length mismatch, so
// gate on length first (a length difference is not itself secret). A missing
// or duplicated (?key=a&key=b → array) param fails closed.
function tokenMatches(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// 저장된 공유 레이아웃을 service-role 로 조회. row 없거나(최초) 파싱 실패 시
// 코드 상수 기본 배치로 fallback — 벽 모니터가 절대 깨지지 않게.
async function loadSharedLayout() {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('dashboard_layouts')
      .select('layout')
      .eq('key', PUBLIC_STATUS_LAYOUT_KEY)
      .maybeSingle();
    return parseLayoutOrDefault(data?.layout);
  } catch {
    return parseLayoutOrDefault(undefined);
  }
}

export default async function StatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ key?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const expected = env.PUBLIC_DASHBOARD_TOKEN;
  // Fail closed: no token provisioned → the public view does not exist.
  if (!expected) notFound();

  const { key } = await searchParams;
  if (!tokenMatches(key, expected)) notFound();

  // Aggregate counts only. Matches the super-admin default view (last 30
  // days, internal accounts excluded) but never fetches the PII roster.
  // 편집 권한 판정: 로그인 세션이 super-admin 이면 canEdit(쿠키 기반 —
  // /status 가 (app) 밖이어도 sb-* 쿠키로 getUser 동작).
  const [report, layout, user] = await Promise.all([
    getAdminAnalytics({ period: '30d', excludeInternal: true }),
    loadSharedLayout(),
    getCurrentUser(),
  ]);

  const canEdit = isSuperAdminEmail(user?.email);

  return (
    <div className="px-2 py-6">
      <AutoRefresh intervalMs={60000} />
      <StatusWidgetBoard
        report={report}
        initialLayout={layout}
        canEdit={canEdit}
      />
    </div>
  );
}
