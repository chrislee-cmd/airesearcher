import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import {
  CANVAS_ORDER,
  resolveCanvasVisibility,
  type CanvasWidgetKey,
  type ResolvedCanvasVisibility,
} from './visibility';

// getCanvasVisibility — 캔버스 노출 해석의 서버측 진입점. widget_visibility DB
// 플래그를 요청당 1회(React cache) 로드해 코드 기본값 위에 override 하고,
// 슈퍼어드민이면 전 위젯 노출 + off 위젯 뱃지 목록을 반환한다.
//
// 제약 1(하드): DB 조회 실패가 캔버스 렌더를 절대 블로킹/실패시키지 않는다 —
// try/catch 로 삼키고 빈 플래그({})로 resolve → 순수하게 코드 기본값 fallback.
//
// email 을 인자로 받는 이유: 호출부(canvas/page.tsx)가 이미 유저를 해석해 두었을
// 수 있어 중복 auth 왕복을 피한다. null/undefined 면 비-슈퍼어드민으로 처리.
export const getCanvasVisibility = cache(
  async (email: string | null | undefined): Promise<ResolvedCanvasVisibility> => {
    const isSuperAdmin = isSuperAdminEmail(email);
    const dbFlags = await loadWidgetFlags();
    return resolveCanvasVisibility(dbFlags, isSuperAdmin);
  },
);

async function loadWidgetFlags(): Promise<
  Partial<Record<CanvasWidgetKey, boolean>>
> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('widget_visibility')
      .select('widget_key, visible');
    if (error || !data) return {};
    const known = new Set<string>(CANVAS_ORDER);
    const out: Partial<Record<CanvasWidgetKey, boolean>> = {};
    for (const row of data) {
      // 알 수 없는 키(코드에서 제거된 옛 위젯 등)는 무시 — 타입 안전.
      if (known.has(row.widget_key)) {
        out[row.widget_key as CanvasWidgetKey] = row.visible;
      }
    }
    return out;
  } catch {
    // 테이블 미적용(마이그 전 프리뷰)·네트워크 실패 등 — 코드 기본값으로 degrade.
    return {};
  }
}
