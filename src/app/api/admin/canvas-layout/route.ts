import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { logAudit } from '@/lib/audit';
import {
  CanvasLayoutSchema,
  normalizeCanvasLayout,
  parsePublishedLayout,
  PUBLISHED_CANVAS_LAYOUT_KEY,
} from '@/lib/admin/canvas-layout';

export const maxDuration = 30;

/* ────────────────────────────────────────────────────────────────────
   /canvas 발행 배치 write/read API — 슈퍼어드민 전용.

   POST { positions:{ "<widgetKey>":{ col,row } } } → 위젯 key 화이트리스트
   (CANVAS_ORDER) 검증 + col/row clamp(normalize) → canvas_layout_publish 의
   key='global' 단일 row upsert(version++). 발행 배치가 일반계정의 초기 렌더
   baseline 이 된다.

   슈퍼어드민 검증은 서버측(isSuperAdminEmail) — 클라 신뢰 금지. 비-슈퍼어드민은
   404(403 아님) — 라우트 존재 자체를 감춘다(/api/admin/* 공통 패턴).
   ──────────────────────────────────────────────────────────────────── */

// GET — 현재 발행 배치 + version 조회(발행 UI 가 상태 표시). 발행 이력 없으면
// null.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('canvas_layout_publish')
    .select('positions, version, published_at')
    .eq('key', PUBLISHED_CANVAS_LAYOUT_KEY)
    .maybeSingle();

  if (error) {
    console.error('[admin/canvas-layout] load error', error);
    return NextResponse.json(
      { error: 'canvas_layout_load_error' },
      { status: 500 },
    );
  }

  const layout = data ? parsePublishedLayout(data.positions, data.version) : null;
  return NextResponse.json(
    {
      layout,
      publishedAt: data?.published_at ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// POST — 현재 슈퍼어드민 캔버스 배치를 전역 발행. version 은 서버가 현재값 +1 로
// 증가시켜(클라 신뢰 안 함) 일반계정의 stale 재적용 트리거로 쓴다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let parsed: ReturnType<typeof CanvasLayoutSchema.safeParse>;
  try {
    parsed = CanvasLayoutSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_layout' }, { status: 400 });
  }

  // 화이트리스트 밖 key 제거 + col/row clamp 를 서버가 재보장(클라 신뢰 안 함).
  const positions = normalizeCanvasLayout(parsed.data);
  if (Object.keys(positions).length === 0) {
    return NextResponse.json({ error: 'empty_layout' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 현재 version 을 읽어 +1. 발행 이력 없으면 0 → 첫 발행 version=1.
  const { data: current, error: readErr } = await admin
    .from('canvas_layout_publish')
    .select('version')
    .eq('key', PUBLISHED_CANVAS_LAYOUT_KEY)
    .maybeSingle();
  if (readErr) {
    console.error('[admin/canvas-layout] version read error', readErr);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
  const nextVersion =
    (typeof current?.version === 'number' ? current.version : 0) + 1;

  const { data, error } = await admin
    .from('canvas_layout_publish')
    .upsert(
      {
        key: PUBLISHED_CANVAS_LAYOUT_KEY,
        positions,
        version: nextVersion,
        published_at: new Date().toISOString(),
        published_by: user!.id,
      },
      { onConflict: 'key' },
    )
    .select('positions, version')
    .single();

  if (error) {
    console.error('[admin/canvas-layout] upsert error', error);
    await logAudit({
      event_type: 'admin_action_error',
      user_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      resource_type: 'canvas_layout_publish',
      metadata: {
        action: 'publish_canvas_layout',
        db_code: error.code ?? null,
        db_message: error.message ?? null,
      },
      request,
    });
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }

  await logAudit({
    event_type: 'admin_action',
    user_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    resource_type: 'canvas_layout_publish',
    metadata: {
      action: 'publish_canvas_layout',
      version: nextVersion,
      widget_count: Object.keys(positions).length,
    },
    request,
  });

  // 저장된 canonical 레이아웃을 되돌려준다(클라가 서버 정규화 결과로 동기화).
  return NextResponse.json(
    { layout: parsePublishedLayout(data?.positions, data?.version) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
