import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  PUBLISHED_CANVAS_LAYOUT_KEY,
  parsePublishedLayout,
  type PublishedCanvasLayout,
} from '@/lib/admin/canvas-layout';

// getPublishedCanvasLayout — 발행된 캔버스 배치의 서버측 진입점. 단일 전역 row
// (key='global')를 요청당 1회(React cache) 로드해 canvas/page.tsx 가 board 로
// 전달한다.
//
// 제약(하드): DB 조회 실패/미적용(마이그 전 프리뷰)이 캔버스 렌더를 절대
// 블로킹/실패시키지 않는다 — try/catch 로 삼키고 null 반환 → board 는 종전
// defaultPositions 폴백(회귀 0). authenticated select 정책으로 로드하므로
// service-role 불필요(발행값은 비밀이 아님).
export const getPublishedCanvasLayout = cache(
  async (): Promise<PublishedCanvasLayout | null> => {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from('canvas_layout_publish')
        .select('positions, version')
        .eq('key', PUBLISHED_CANVAS_LAYOUT_KEY)
        .maybeSingle();
      if (error || !data) return null;
      return parsePublishedLayout(data.positions, data.version);
    } catch {
      // 테이블 미적용·네트워크 실패 등 — 발행 없음으로 degrade.
      return null;
    }
  },
);
