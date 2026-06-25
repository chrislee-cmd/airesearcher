'use client';

/* ────────────────────────────────────────────────────────────────────
   오토컨텐츠 (autocontents) — canvas widget.

   PR-N1 (이 PR): 위젯 등록 + placeholder body. preview-gated.
   PR-N2: enko 코드베이스 UI 포팅 (FileDropZone / preview / topics / image).
   PR-N3: API 실 구현 + auth/credit gate + 통합 검증.

   현재 위젯은 등록만 되어 있고 실제 동작 안 함. is_unlimited org 만
   노출되어 일반 유저에는 영향 0.
   ──────────────────────────────────────────────────────────────────── */

import type { WidgetContent } from '../widget-types';

function ExpandedBody() {
  return (
    <div className="space-y-3">
      <div className="text-md text-mute">
        <strong className="text-ink-2">오토컨텐츠</strong> 위젯 — UI
        마이그레이션 진행 중 (AC-N2).
      </div>
      <div className="text-sm text-mute-soft">
        PR-N2 에서 enko 코드베이스의 콘텐츠 생성 UI (보고서 → 토픽 → 본문 →
        이미지 → Notion/WordPress 배포) 가 본문으로 들어옵니다.
      </div>
      <div className="h-32 rounded-xs border border-dashed border-line-soft bg-paper" />
    </div>
  );
}

export const autocontentsCard: WidgetContent = {
  key: 'autocontents',
  meta: {
    label: '오토컨텐츠',
    // lav (라벤더) — 현재 8개 위젯이 sky/peach/mint/sun/rose 를 공유하는
    // 구조. lav 는 분석 톤과 구분되는 산출/배포 톤으로 단독 사용.
    accent: 'lav',
    cost: 0,
    description: '콘텐츠 자동 생성 도구 — 마이그 진행 중',
    // 다른 위젯과 동일한 표준 3-셀 너비.
    expandedCols: 3,
    // AC1 (#405) 의 multi-row 인프라 활용 — 위젯 3개 stack 합친 높이 (2496px)
    // 로 보고서/토픽/본문/미리보기/이미지 패널이 한 화면에 들어가게.
    expandedRows: 3,
  },
  state: 'idle',
  ExpandedBody,
};
