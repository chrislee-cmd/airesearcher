'use client';

/* ────────────────────────────────────────────────────────────────────
   오토컨텐츠 (autocontents) — canvas widget.

   PR-N1: 위젯 등록 + placeholder body. preview-gated.
   PR-N2 (이 PR): enko 코드베이스 UI 포팅 (~7.4k 줄) +
                  ai-researcher 디자인 토큰 / primitive 치환.
                  API 호출은 AC-N1 의 shell (401/501) 그대로 — 실 응답은 AC-N3.
   PR-N3: API 실 구현 + auth/credit gate + 통합 검증.
   ──────────────────────────────────────────────────────────────────── */

import TopicsClient from '@/components/autocontents/topics-client';
import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="-mx-4 -mb-4">
      <TopicsClient />
    </div>
  );
}

export const autocontentsCard: WidgetContent = {
  key: 'autocontents',
  meta: {
    label: '오토컨텐츠',
    accent: 'lav',
    cost: 0,
    description: '콘텐츠 자동 생성 도구 — 마이그 진행 중',
    // 보드 좌측 절반 (3 cols = 816px) 을 세로로 (4 rows = 3344px) 차지.
    // CANVAS_ORDER 에서 첫 번째 위치 + row-major auto-layout 로 보드 top-left
    // 점유 → 다른 6개 위젯이 우측 (cols 3-5) 에 stack. 인스펙터가 열렸을 때
    // 위젯 내부에서 캔버스 아래로 stack (lg 사이드바 미사용).
    expandedCols: 3,
    expandedRows: 4,
  },
  state: 'idle',
  ExpandedBody,
};
