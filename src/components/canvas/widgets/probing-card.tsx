'use client';

/* ────────────────────────────────────────────────────────────────────
   프로빙 어시스턴트 — canvas widget (PR-1 skeleton).

   PR-1: realtime input transcript 미리보기 + 빈 산출물 영역.
   PR-2: LLM 호출로 후속 질문 (probing) 제안 + 산출물 히스토리.

   provider 가 mount 안 되어 있어도 hook 이 빈 stub 을 반환하므로 안전.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react';
import type { WidgetContent } from '../widget-types';
import { WidgetOutputs } from '@/components/canvas/shell/widget-outputs';
import {
  useRealtimeTranscript,
  type TranscriptSegment,
} from '@/components/realtime-transcript-provider';

// 미리보기 윈도우. 90초면 마지막 2~3 utterance — 인터뷰어가 probing 으로
// 던질 질문을 떠올리기에 충분한 직전 컨텍스트.
const PREVIEW_WINDOW_MS = 90_000;

// transcript 가 멈춰 있을 때도 cutoff 가 흐르도록 1초마다 강제 리렌더.
// (segments 자체는 변하지 않아도 recent() 결과는 시간 흐름에 따라 줄어듦.)
function useNowTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function SegmentRow({ seg }: { seg: TranscriptSegment }) {
  const inFlight = seg.ended_at === undefined;
  return (
    <li
      className={`rounded-xs border px-3 py-2 text-md leading-[1.6] ${
        inFlight
          ? 'border-line-soft bg-paper text-mute'
          : 'border-line bg-paper text-ink-2'
      }`}
    >
      {seg.text}
      {inFlight && <span className="text-mute-soft"> …</span>}
    </li>
  );
}

function ExpandedBody() {
  const { isLive, recent } = useRealtimeTranscript();
  // now 가 1초마다 갱신되면서 useMemo 재계산 — 윈도우 cutoff 가 자연스럽게
  // 흘러간다. (recent 가 segments 의존이라 isLive 가 false 여도 동일하게 동작.)
  const now = useNowTick();
  const segments = useMemo(
    () => recent(PREVIEW_WINDOW_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- now 가 시간 흐름 트리거
    [recent, now],
  );
  const hasTranscript = segments.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* 상단 — live 상태 표시. translate 위젯이 안 켜져 있으면 회색 dot. */}
      <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isLive ? 'bg-amore' : 'bg-line'
            }`}
            aria-hidden
          />
          <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
            {isLive ? '실시간 통역 감지' : '통역 대기 중'}
          </span>
        </div>
        <span className="text-xs text-mute-soft tabular-nums">
          최근 90초
        </span>
      </div>

      {/* 중간 — transcript preview. 빈 상태 placeholder vs 세그먼트 리스트.
          flex-1 로 산출물을 카드 바닥에 고정시킨다. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {hasTranscript ? (
          <ul className="space-y-2">
            {segments.map((s) => (
              <SegmentRow key={s.id} seg={s} />
            ))}
          </ul>
        ) : (
          <div className="rounded-xs border border-dashed border-line-soft bg-paper px-4 py-6 text-center text-md text-mute-soft">
            실시간 통역(translate) 위젯을 먼저 시작해 주세요.
            <br />
            인터뷰가 시작되면 여기서 자동으로 추적합니다.
          </div>
        )}
      </div>

      {/* 산출물 — PR-2 에서 probing 제안 히스토리로 채움. PR-1 은 빈 상태. */}
      <WidgetOutputs
        label="제안 히스토리"
        items={[]}
        renderItem={() => null}
        emptyText="PR-2 에서 probing 제안 히스토리를 여기에 표시 예정"
      />
    </div>
  );
}

export const probingCard: WidgetContent = {
  key: 'probing',
  meta: {
    label: '프로빙 어시스턴트',
    // sky — 분석/컨설팅 톤. 8개 위젯이 6개 accent 색을 공유하는 구조라
    // 재사용 (peach/sun 도 2번씩). translate 의 mint 와 시각 구분.
    accent: 'sky',
    cost: 0,
    thumbnail: '/thumbnail/probing.svg',
    description: '실시간 통역을 듣고 후속 질문을 제안합니다 (PR-2 예정)',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
