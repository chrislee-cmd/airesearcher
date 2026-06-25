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

// chrome (헤더 / accent / pill / description) 은 widget-shell 이 그림.
// ExpandedBody 는 TopicsClient 의 본문만 — 자체 padding 은 topics-client
// 가 내부에서 (px-5 py-5 + flex h-full) 부여하므로 wrapper 불필요.
export const autocontentsCard: WidgetContent = {
  key: 'autocontents',
  meta: {
    label: '오토컨텐츠',
    accent: 'lav',
    cost: 0,
    description: '리포트·블로그·SNS 콘텐츠 자동 생성',
    // 보드 좌측 절반 (3 cols = 816px) 을 세로로 (4 rows = 3344px) 차지.
    // CANVAS_ORDER 에서 첫 번째 위치 + row-major auto-layout 로 보드 top-left
    // 점유 → 다른 6개 위젯이 우측 (cols 3-5) 에 stack. 인스펙터가 열렸을 때
    // 위젯 내부에서 캔버스 아래로 stack.
    expandedCols: 3,
    expandedRows: 4,
  },
  state: 'idle',
  ExpandedBody: TopicsClient,
};
