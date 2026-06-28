'use client';

/* ────────────────────────────────────────────────────────────────────
   ReflectionPane — probing 위젯 좌패널 (PR: probing-two-pane-reflection).

   누적 transcript 를 보고 응답자에 대한 세 섹션 (respondent /
   needs_painpoints / motivation) 의 markdown bullet 텍스트를 표시.
   생성 / 갱신 트리거 / 데이터는 부모 (probing-card.tsx) 가 소유 — 이
   컴포넌트는 순수 표시 + "지금 갱신" 액션만 노출.
   ──────────────────────────────────────────────────────────────────── */

import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';

export type ProbingReflectionData = {
  respondent: string;
  needs_painpoints: string;
  motivation: string;
};

export type ReflectionStatus = 'idle' | 'streaming' | 'ready' | 'error';

const memphisPlaceholderStyle = {
  border: '2px solid var(--canvas-card-border)',
  borderRadius: 'var(--sidebar-nav-radius)',
  boxShadow: 'var(--memphis-shadow-xs)',
} as const;

function formatRelativeKo(epochMs: number | null, nowMs: number): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return '방금 전 갱신';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전 갱신`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}시간 전 갱신`;
  return `${Math.floor(diff / 86_400_000)}일 전 갱신`;
}

function Section({ title, body }: { title: string; body: string }) {
  const trimmed = body.trim();
  return (
    <section className="flex flex-col gap-1.5">
      <SectionLabel>{title}</SectionLabel>
      <div className="whitespace-pre-wrap text-md leading-[1.6] text-ink-2">
        {trimmed.length > 0 ? trimmed : '단서 부족'}
      </div>
    </section>
  );
}

export function ReflectionPane({
  data,
  status,
  lastUpdatedAt,
  nowMs,
  error,
  canRefresh,
  onRefresh,
  isLive,
  hasTranscript,
}: {
  data: ProbingReflectionData | null;
  status: ReflectionStatus;
  lastUpdatedAt: number | null;
  nowMs: number;
  error: string | null;
  canRefresh: boolean;
  onRefresh: () => void;
  isLive: boolean;
  hasTranscript: boolean;
}) {
  const stamp = formatRelativeKo(lastUpdatedAt, nowMs);
  const headerLabel =
    status === 'streaming'
      ? '갱신 중…'
      : stamp || (status === 'error' ? '갱신 실패' : '대기 중');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SectionLabel>응답자 성찰</SectionLabel>
          <span className="text-xs text-mute-soft">· {headerLabel}</span>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={onRefresh}
          disabled={!canRefresh}
          loading={status === 'streaming'}
          loadingLabel="갱신 중…"
          className="uppercase tracking-[0.18em]"
        >
          지금 갱신
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {data ? (
          <div className="flex flex-col gap-4">
            <Section title="응답자 (지금까지의 단서)" body={data.respondent} />
            <Section title="니즈 / 페인포인트" body={data.needs_painpoints} />
            <Section title="응답 동기 / 사고 흐름" body={data.motivation} />
          </div>
        ) : status === 'streaming' ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            응답자 성찰 생성 중…
          </div>
        ) : !isLive ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            세션을 시작하면 발화에서 응답자에 대한 가설이 정리됩니다.
          </div>
        ) : !hasTranscript ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            transcript 가 들어오면 첫 성찰이 표시됩니다.
          </div>
        ) : (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            발화가 더 모이면 자동으로 성찰이 갱신됩니다.
            <br />
            &lsquo;지금 갱신&rsquo; 으로 즉시 시도할 수도 있어요.
          </div>
        )}

        {error && (
          <div
            className="mt-3 bg-paper px-3 py-2 text-sm text-warning"
            style={{
              border: '2px solid var(--color-warning)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: '2px 2px 0 var(--color-warning)',
            }}
          >
            성찰 생성 실패: {error}
          </div>
        )}
      </div>
    </div>
  );
}
