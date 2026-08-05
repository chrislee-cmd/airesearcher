import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { logAudit } from '@/lib/audit';
import {
  CANVAS_VISIBILITY,
  TOGGLEABLE_WIDGET_KEYS,
  type CanvasWidgetKey,
} from '@/lib/canvas/visibility';

export const maxDuration = 30;

const TOGGLEABLE = new Set<string>(TOGGLEABLE_WIDGET_KEYS);

// 슈퍼어드민 전용. 비-슈퍼어드민에겐 404 로 라우트 존재 자체를 숨긴다(payments
// 라우트 관례와 동일). 노출 제어만 — 기능 API/데이터는 건드리지 않는다.

// GET — 토글 위젯 9종의 현재 노출 상태(코드 기본값 ⊕ DB override) + 마지막 변경.
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
    .from('widget_visibility')
    .select('widget_key, visible, updated_at');

  if (error) {
    console.error('[admin/widget-visibility] load error', error);
    return NextResponse.json(
      { error: 'widget_visibility_load_error' },
      { status: 500 },
    );
  }

  const byKey = new Map(
    (data ?? []).map((r) => [r.widget_key, r] as const),
  );
  // 토글 화면 순서(CANVAS_ORDER 기반) 그대로. 행이 없으면 코드 기본값 노출.
  const widgets = TOGGLEABLE_WIDGET_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      visible: row ? row.visible : CANVAS_VISIBILITY[key],
      updatedAt: row?.updated_at ?? null,
    };
  });

  return NextResponse.json(
    { widgets },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// PUT — 단일 위젯 노출 토글. body: { widgetKey, visible }. service-role upsert.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isSuperAdminEmail(user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const widgetKey =
    body && typeof body === 'object' && 'widgetKey' in body
      ? (body as { widgetKey: unknown }).widgetKey
      : undefined;
  const visible =
    body && typeof body === 'object' && 'visible' in body
      ? (body as { visible: unknown }).visible
      : undefined;

  if (typeof widgetKey !== 'string' || !TOGGLEABLE.has(widgetKey)) {
    return NextResponse.json({ error: 'invalid_widget_key' }, { status: 400 });
  }
  if (typeof visible !== 'boolean') {
    return NextResponse.json({ error: 'invalid_visible' }, { status: 400 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin.from('widget_visibility').upsert(
    {
      widget_key: widgetKey,
      visible,
      updated_at: nowIso,
      updated_by: user?.id ?? null,
    },
    { onConflict: 'widget_key' },
  );

  if (error) {
    console.error('[admin/widget-visibility] upsert error', error);
    await logAudit({
      event_type: 'admin_action_error',
      user_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      resource_type: 'widget_visibility',
      metadata: {
        action: 'set_widget_visibility',
        widget_key: widgetKey,
        visible,
        db_code: error.code ?? null,
        db_message: error.message ?? null,
      },
      request,
    });
    return NextResponse.json(
      { error: 'widget_visibility_update_error' },
      { status: 500 },
    );
  }

  await logAudit({
    event_type: 'admin_action',
    user_id: user?.id ?? null,
    actor_email: user?.email ?? null,
    resource_type: 'widget_visibility',
    metadata: {
      action: 'set_widget_visibility',
      widget_key: widgetKey as CanvasWidgetKey,
      visible,
    },
    request,
  });

  return NextResponse.json(
    { widgetKey, visible, updatedAt: nowIso },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
