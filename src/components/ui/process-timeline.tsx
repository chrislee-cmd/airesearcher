'use client';

// ─── ProcessTimeline — 위젯 공정 과정 멀티-라인 타임라인 primitive ──────────
// 데스크 / 전사록 / 인터뷰V2 위젯이 "지금 어디까지 왔고 앞으로 뭐가 남았는지"
// 를 세로 목록으로 보여준다. 각 단계는 done(✅) / active(🔄) / pending(⏸) 세
// 상태 중 하나이고, 상태는 아이콘·색·굵기로 표현된다 (라벨은 단계마다 하나 —
// 상태별 문구 변형 없이 아이콘이 상태를 전달, spec Phase 매핑 표 기준).
//
// 색은 디자인 토큰만 사용: done=text-amore, active=text-ink, pending=
// text-mute-soft (PROJECT.md §9). 색 하드코드 없음.

export type ProcessPhase = {
  key: string;
  label: string;
  status: 'done' | 'active' | 'pending';
  // 예: "45/120" — active 단계에서만 노출.
  detail?: string;
};

// 정의된 단계 목록 + 현재 단계 key 로 done/active/pending 상태를 계산한다.
// - allDone=true → 전부 done (job 완료)
// - currentKey 가 목록 안에 있으면 그 앞은 done, 그 자리는 active, 뒤는 pending
// - currentKey 가 null/미발견이면 전부 pending (막 시작해 아직 phase 미보고)
export function buildLinearPhases(
  defs: { key: string; label: string; detail?: string }[],
  currentKey: string | null,
  opts?: { allDone?: boolean },
): ProcessPhase[] {
  const allDone = opts?.allDone ?? false;
  const currentIdx = currentKey
    ? defs.findIndex((d) => d.key === currentKey)
    : -1;
  return defs.map((d, i) => {
    let status: ProcessPhase['status'];
    if (allDone) status = 'done';
    else if (currentIdx < 0) status = 'pending';
    else if (i < currentIdx) status = 'done';
    else if (i === currentIdx) status = 'active';
    else status = 'pending';
    return {
      key: d.key,
      label: d.label,
      status,
      // detail 은 active 단계에서만 의미 (현재 진행 중인 세부 카운트).
      detail: status === 'active' ? d.detail : undefined,
    };
  });
}

export function ProcessTimeline({
  phases,
  // 컨트롤 영역 전체 대체(데스크/전사록)는 기본 넉넉한 padding, compact 인라인
  // (인터뷰 파일 요약)은 좁은 padding 을 넘겨 쓴다.
  padding = 'py-8 px-6',
}: {
  phases: ProcessPhase[];
  padding?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 ${padding}`}>
      {phases.map((p) => {
        const iconTone =
          p.status === 'done'
            ? 'text-amore'
            : p.status === 'active'
              ? 'text-ink animate-pulse'
              : 'text-mute-soft';
        const labelTone =
          p.status === 'active'
            ? 'font-semibold text-ink'
            : p.status === 'pending'
              ? 'text-mute'
              : 'text-ink-2';
        return (
          <div key={p.key} className="flex items-start gap-3 text-md">
            <span
              aria-hidden
              className={`shrink-0 w-5 h-5 flex items-center justify-center ${iconTone}`}
            >
              {p.status === 'done' ? '✅' : p.status === 'active' ? '🔄' : '⏸'}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className={labelTone}>{p.label}</span>
              {p.detail && p.status === 'active' && (
                <span className="text-xs tabular-nums text-mute-soft">
                  {p.detail}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
