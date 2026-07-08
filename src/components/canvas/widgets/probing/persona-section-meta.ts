/* ────────────────────────────────────────────────────────────────────
   persona-section-meta — 기본 페르소나 섹션의 UI 메타 (icon + 표시 title).

   PR (probing-persona-section-configurator #470): 옛날엔 reflection-pane 이
   PANELS 배열로 icon+title 을 로컬 소유했는데, 이제 **컨트롤 패널 구성기**
   (persona-section-configurator) 도 같은 카드 메타를 그려야 하므로 단일
   SSOT 로 분리한다. 렌더 (reflection-pane grid) 와 구성 (configurator
   ModeButton 카드) 가 icon/title 을 항상 공유 → 라벨 불일치 0.

   섹션의 key / 프롬프트 description 은 여전히 probing-prompts.ts 의
   DEFAULT_PERSONA_SECTIONS 가 SSOT (요청·prompt 계약). 여기 title 은
   사용자에게 보이는 짧은 라벨 (예: '데모그래픽'), DEFAULT_PERSONA_SECTIONS
   의 title (예: '인구통계') 은 LLM prompt 용 — 서로 독립.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingPersonaSectionKey } from '@/lib/probing-prompts';

export type PersonaPanelMeta = {
  key: ProbingPersonaSectionKey;
  icon: string;
  title: string;
};

// 그리드 순서 — 정체성 → 가치관 → 선호 → 욕구 → 행동, catch-all "기타"
// 마지막. reflection-pane grid 와 configurator 카드가 동일 순서로 렌더.
export const DEFAULT_PERSONA_PANELS: PersonaPanelMeta[] = [
  { key: 'demographics', icon: '👤', title: '데모그래픽' },
  { key: 'values', icon: '🌱', title: '가치관' },
  { key: 'preferences', icon: '💎', title: '선호' },
  { key: 'needs', icon: '🎯', title: '니즈' },
  { key: 'painpoints', icon: '⚠️', title: '페인포인트' },
  { key: 'brand_perception', icon: '🏷️', title: '브랜드 인식' },
  { key: 'decision_drivers', icon: '🧭', title: '의사결정 요인' },
  { key: 'behavioral_patterns', icon: '🔁', title: '행동 패턴' },
  // catch-all "기타" (probing-default-etc-widget). 다른 8 기본과 동일하게
  // 구성기에서 on/off 가능.
  { key: 'etc', icon: '📎', title: '기타' },
];

// custom 섹션 카드 아이콘 (기본 9 와 구분되는 조각 글리프).
export const CUSTOM_PANEL_ICON = '🧩';
