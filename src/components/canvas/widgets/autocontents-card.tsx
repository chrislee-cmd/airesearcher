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
    // 보드 전체 너비 (1680px). 메인 캔버스 + 우측 사이드바 인스펙터를
    // 둘 다 넉넉히 수용 (440px 사이드바 + 1fr 메인).
    expandedCols: 6,
    expandedRows: 3,
  },
  state: 'idle',
  ExpandedBody,
};
