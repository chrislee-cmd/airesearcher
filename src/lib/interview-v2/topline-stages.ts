import type { StageStatus } from '@/components/ui/stage-flow';
import type { ToplineStatus } from './types';

// 탑라인 생성(map-reduce) 공정 → StageFlow ordered 단계 매핑의 SSOT. 카드 ambient
// 밴드(interviews-card)와 fullview(topline-view)가 같은 파생을 공유해 "카드/전체보기
// 진행 상태 일관"(#434) 을 코드로 보장한다 — 로직 복붙 금지.
//
// 공정 3단계:
//   1) 전 문서 분석 (map)  — 전 응답자 문서를 순회. 진행률 = map_done/map_total.
//   2) 교차 종합 (reduce)  — map 완료 후 블록으로 합성. blocks 도착 전까지 active.
//   3) 보고서 완성 (finalize) — status='done'.
//
// 진행 = active(glow), 완료 = done(체크), 대기 = pending. status='error' 는 그 시점
// in-flight 단계를 error 로(무음 금지). 전 단계 done 이면 complete=true → 완료 hero.

export type ToplineStageKey = 'map' | 'reduce' | 'finalize';

export type ToplineFlow = {
  stages: { key: ToplineStageKey; status: StageStatus }[];
  complete: boolean;
};

export function deriveToplineFlow(
  status: ToplineStatus,
  mapTotal: number | null | undefined,
  mapDone: number | null | undefined,
  hasBlocks: boolean,
): ToplineFlow {
  const mk = (
    map: StageStatus,
    reduce: StageStatus,
    finalize: StageStatus,
  ): ToplineFlow['stages'] => [
    { key: 'map', status: map },
    { key: 'reduce', status: reduce },
    { key: 'finalize', status: finalize },
  ];

  // 전 단계 완료 — 완료 hero.
  if (status === 'done') {
    return { stages: mk('done', 'done', 'done'), complete: true };
  }

  const total = mapTotal ?? 0;
  const done = Math.max(0, Math.min(mapDone ?? 0, total > 0 ? total : mapDone ?? 0));
  const mapComplete = total > 0 && done >= total;

  if (status === 'error') {
    // in-flight 단계에 error 를 표시하고 이전은 done, 이후는 pending 으로 남긴다.
    if (mapComplete && hasBlocks) return { stages: mk('done', 'done', 'error'), complete: false };
    if (mapComplete) return { stages: mk('done', 'error', 'pending'), complete: false };
    return { stages: mk('error', 'pending', 'pending'), complete: false };
  }

  // generating (또는 낙관적 none→generating). 관측 가능한 진행점에 active 를 둔다.
  if (total > 0 && !mapComplete) {
    return { stages: mk('active', 'pending', 'pending'), complete: false };
  }
  if (mapComplete && !hasBlocks) {
    return { stages: mk('done', 'active', 'pending'), complete: false };
  }
  if (hasBlocks) {
    // 블록이 스트리밍돼 들어왔지만 status 가 아직 done 이 아님 → 마무리 중.
    return { stages: mk('done', 'done', 'active'), complete: false };
  }
  // 아직 map 정보 없음 — map 이 막 시작.
  return { stages: mk('active', 'pending', 'pending'), complete: false };
}
