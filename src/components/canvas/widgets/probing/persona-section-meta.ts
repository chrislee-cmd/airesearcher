/* ────────────────────────────────────────────────────────────────────
   persona-section-meta — 기본 페르소나 섹션의 UI 메타 (icon + 표시 title).

   PR (probing-persona-section-configurator #470): 옛날엔 reflection-pane 이
   PANELS 배열로 icon+title 을 로컬 소유했는데, 이제 **컨트롤 패널 구성기**
   (persona-section-configurator) 도 같은 카드 메타를 그려야 하므로 단일
   SSOT 로 분리한다. 렌더 (reflection-pane grid) 와 구성 (configurator
   ModeButton 카드) 가 icon/title 을 항상 공유 → 라벨 불일치 0.

   섹션의 key / 프롬프트 description 은 여전히 probing-prompts.ts 의
   DEFAULT_PERSONA_SECTIONS 가 SSOT (요청·prompt 계약). 사용자에게 보이는 짧은
   라벨은 이제 messages 의 `Probing.personaSection.<key>` (i18n) 에서 온다 —
   consumer (reflection-pane / configurator) 가 key 로 t() 해석. LLM prompt 용
   title (예: '인구통계') 은 DEFAULT_PERSONA_SECTIONS 소유로 서로 독립.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingPersonaSectionKey } from '@/lib/probing-prompts';

export type PersonaPanelMeta = {
  key: ProbingPersonaSectionKey;
  icon: string;
};

// 그리드 순서 — 정체성 → 가치관 → 선호 → 욕구 → 행동, catch-all "기타"
// 마지막. reflection-pane grid 와 configurator 카드가 동일 순서로 렌더.
// 표시 라벨은 `Probing.personaSection.<key>` (i18n) — 여기선 key + icon 만.
export const DEFAULT_PERSONA_PANELS: PersonaPanelMeta[] = [
  { key: 'demographics', icon: '👤' },
  { key: 'values', icon: '🌱' },
  { key: 'preferences', icon: '💎' },
  { key: 'needs', icon: '🎯' },
  { key: 'painpoints', icon: '⚠️' },
  { key: 'brand_perception', icon: '🏷️' },
  { key: 'decision_drivers', icon: '🧭' },
  { key: 'behavioral_patterns', icon: '🔁' },
  // catch-all "기타" (probing-default-etc-widget). 다른 8 기본과 동일하게
  // 구성기에서 on/off 가능.
  { key: 'etc', icon: '📎' },
];

// custom 섹션 카드 아이콘 (기본 9 와 구분되는 조각 글리프).
export const CUSTOM_PANEL_ICON = '🧩';
