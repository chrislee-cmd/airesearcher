import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  CANVAS_VISIBILITY,
  TOGGLEABLE_WIDGET_KEYS,
} from '@/lib/canvas/visibility';
import { AdminWidgetVisibility } from '@/components/admin-widget-visibility';

// 슈퍼어드민 전용. 다른 계정엔 notFound() 로 라우트 존재를 숨긴다(다른 admin
// 페이지 관례와 동일).
export default async function AdminWidgetVisibilityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!isSuperAdminEmail(user?.email)) notFound();

  // 초기 상태를 서버에서 로드해 SSR — 클라 깜빡임 방지. 실패해도 코드 기본값으로
  // degrade(페이지는 뜬다).
  const admin = createAdminClient();
  const { data } = await admin
    .from('widget_visibility')
    .select('widget_key, visible, updated_at');
  const byKey = new Map((data ?? []).map((r) => [r.widget_key, r] as const));

  const initialWidgets = TOGGLEABLE_WIDGET_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      visible: row ? row.visible : CANVAS_VISIBILITY[key],
      updatedAt: row?.updated_at ?? null,
    };
  });

  return <AdminWidgetVisibility initialWidgets={initialWidgets} />;
}
