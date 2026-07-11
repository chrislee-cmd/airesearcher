import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  DashboardLayoutSchema,
  normalizeLayout,
  parseLayoutOrDefault,
  PUBLIC_STATUS_LAYOUT_KEY,
} from '@/lib/admin/dashboard-layout';

/* ────────────────────────────────────────────────────────────────────
   /status 위젯 보드 공유 레이아웃 write API — super-admin 전용.

   POST { version:1, widgets:[{ id, span }] } → 위젯 id 화이트리스트(zod enum)
   검증 + 중복 제거 + span clamp(normalize) → dashboard_layouts 의
   key='public-status' 단일 row upsert.

   /status 는 로그인 없는 공개 토큰 URL 이므로, 공개 토큰만 아는 시청자가 공유
   보드를 write 로 헝클 수 없도록 이 라우트는 super-admin 세션이 유일한 관문이다.
   비-admin 은 404(403 아님) — 라우트 존재 자체를 감춘다(/api/admin/* 공통 패턴).
   ──────────────────────────────────────────────────────────────────── */

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof DashboardLayoutSchema.safeParse>;
  try {
    parsed = DashboardLayoutSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!parsed.success) {
    // 화이트리스트 밖 위젯 id / span 범위 위반 / 형식 오류 → 저장 거부.
    return NextResponse.json({ error: 'invalid_layout' }, { status: 400 });
  }

  // 중복 id 제거 + span clamp 를 서버가 재보장(클라이언트 신뢰하지 않음).
  const layout = normalizeLayout(parsed.data);
  if (layout.widgets.length === 0) {
    return NextResponse.json({ error: 'empty_layout' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('dashboard_layouts')
    .upsert(
      {
        key: PUBLIC_STATUS_LAYOUT_KEY,
        layout,
        updated_by: user!.id,
      },
      { onConflict: 'key' },
    )
    .select('layout')
    .single();

  if (error) {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  // 저장된 canonical 레이아웃을 되돌려준다(클라이언트가 서버 정규화 결과로 동기화).
  return NextResponse.json(
    { layout: parseLayoutOrDefault(data?.layout) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
