/* ────────────────────────────────────────────────────────────────────
   probing-widget-weight — 프로빙 페르소나 위젯의 "제안 질문 우선순위" 가중치.

   PR (probing-custom-widget-priority-weight): 옛 = 기본 8 페르소나 위젯 +
   사용자 custom 위젯이 제안 질문(popup / EMIT) 생성에 **동등 가중치**로
   반영. 신 = **custom 위젯 = 더 높은 가중치** → AI 가 즉시 질문을 만들 때
   비어 있는 custom 위젯을 채우는 질문을 우선한다.

   왜 별 모듈인가 (spec 의 "section-definitions.ts (or 유사)" 해석):
   persona 섹션 정의 (ProbingPersonaSectionDef) 는 기본 8 은 static, custom
   은 localStorage 기반 동적이라 SectionMeta.weight 를 def 마다 박으면 두
   소비처 (probing-prompts 의 schema / probing-card 의 렌더) 로 ripple 이
   커진다. weight + fill-rate 계산은 "제안 질문 우선순위" 라는 단일 관심사라
   여기 한 곳에 모은다. think route (backend) 와 probing-card (client) 가
   같은 계산을 공유하므로 클라이언트/서버 어디서도 import 가능한 순수 모듈.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingPersonaSection } from '@/lib/probing-prompts';

// 위젯 종류별 가중치 — 0 (낮음) ~ 1 (최고).
// custom = 사용자가 명시적으로 추가한 조사 목적 위젯 → 최우선.
// default = 기본 8 페르소나 위젯 → 중간.
// catchall = "기타" 성격의 위젯 (병렬 PR pr-probing-default-etc-widget) →
//   catch-all 이라 자연 채워지므로 낮음. 현재 이 repo 엔 catch-all 위젯이
//   없어 참조만 — is_custom=false 이면서 catchall 마킹된 위젯에만 적용.
export const DEFAULT_WEIGHT = 0.5;
export const CUSTOM_WEIGHT = 1.0;
export const CATCHALL_WEIGHT = 0.3;

// fill rate 이 이 값 미만이면 "empty (비어 있음)" 로 간주. spec §B 룰 1~3 의
// "empty (fill rate < 30%)" 임계값.
export const EMPTY_FILL_THRESHOLD = 0.3;

// think route 로 전달 / prompt 에 반영되는 위젯 1개의 상태.
//   alias — LLM 이 target_section 으로 되돌려 참조하는 짧은 식별자. 기본 8 은
//     semantic key (needs / painpoints ...), custom 은 ordinal alias
//     (custom_1..N). custom 원본 key 는 crypto.randomUUID() (36자 opaque) 라
//     모델이 verbatim 재현하지 못해 — reflection route 의 alias 패턴과 동일.
//   label — 사람 친화 라벨 (위젯 제목). prompt / popup 뱃지 표시용.
//   weight — DEFAULT_WEIGHT / CUSTOM_WEIGHT / CATCHALL_WEIGHT.
//   fill_rate — 0~1. 현재 채움 정도 (sectionFillRate 결과).
//   is_custom — custom 위젯 여부 (prompt 에서 우선순위 룰 분기).
export type ProbingWidgetStatus = {
  alias: string;
  label: string;
  weight: number;
  fill_rate: number;
  is_custom: boolean;
};

/* 위젯 1개의 fill rate (0~1) — reflection 결과 섹션의 채움 정도.

   근거: confidence (신호 강도) + signals 밀도 + summary 유무 를 블렌드.
   - insufficient / 섹션 없음 → 0 (완전 empty).
   - confidence 50% + signals(≤3 정규화) 40% + summary 유무 10%.

   spec §B "fill_rate 계산 = 위젯별 append 된 텍스트 길이 or item 수" 를
   confidence + signal 수로 근사. persona-panel.tsx 의 insufficient 판정
   (confidence='insufficient' 또는 summary/signals 모두 빈 것) 과 정합. */
export function sectionFillRate(
  section: ProbingPersonaSection | null | undefined,
): number {
  if (!section) return 0;
  const confidence = section.confidence;
  if (confidence === 'insufficient') return 0;
  const summaryFilled = (section.summary?.trim().length ?? 0) > 0 ? 1 : 0;
  const signalCount = (section.signals ?? []).filter(
    (s) => (s?.bullet?.trim().length ?? 0) > 0,
  ).length;
  const signalScore = Math.min(1, signalCount / 3);
  const confScore =
    confidence === 'high' ? 1 : confidence === 'medium' ? 0.66 : 0.33;
  const raw = 0.5 * confScore + 0.4 * signalScore + 0.1 * summaryFilled;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
}

// 우선순위 점수 = weight × (1 - fill_rate). 높을수록 "지금 채워야 할" 위젯.
// spec §B: "제안 질문 = 가중치 * (1 - fill_rate) 순으로 정렬 → 최상위 1개".
export function widgetPriorityScore(w: ProbingWidgetStatus): number {
  return w.weight * (1 - w.fill_rate);
}

// 우선순위 내림차순 정렬 (원본 불변). 동점이면 custom 을 앞으로 (가중치 룰의
// 의도 — custom 우선). 그 다음 fill_rate 낮은 순 (더 비어 있는 것 먼저).
export function sortWidgetsByPriority(
  widgets: ProbingWidgetStatus[],
): ProbingWidgetStatus[] {
  return [...widgets].sort((a, b) => {
    const diff = widgetPriorityScore(b) - widgetPriorityScore(a);
    if (Math.abs(diff) > 1e-6) return diff;
    if (a.is_custom !== b.is_custom) return a.is_custom ? -1 : 1;
    return a.fill_rate - b.fill_rate;
  });
}

// 위젯이 "empty (우선 채우기 대상)" 인지 — fill_rate < 임계값.
export function isWidgetEmpty(w: ProbingWidgetStatus): boolean {
  return w.fill_rate < EMPTY_FILL_THRESHOLD;
}
