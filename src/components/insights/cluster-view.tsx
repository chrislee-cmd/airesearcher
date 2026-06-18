'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ClusterWithQuotes } from '@/lib/insights-clusters-load';

const PREVIEW_QUOTES = 3;

// Renders a single cluster card. Quote list is collapsed by default to
// PREVIEW_QUOTES, with a "더 보기 / 접기" toggle for the rest. We keep
// the toggle state per-cluster (not lifted) because each card is
// independent — a user opening one cluster doesn't imply intent to open
// the others.
function ClusterCard({ cluster }: { cluster: ClusterWithQuotes }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? cluster.quotes
    : cluster.quotes.slice(0, PREVIEW_QUOTES);
  const hidden = cluster.quotes.length - visible.length;

  return (
    <div className="border border-line bg-paper p-4 rounded-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink-2">
          {cluster.label}
        </h3>
        <span className="shrink-0 text-sm tabular-nums text-mute-soft">
          {cluster.quotes.length} 인용구
        </span>
      </div>
      {cluster.insight && (
        <p className="mt-1.5 text-md leading-[1.55] text-mute">
          {cluster.insight}
        </p>
      )}
      {cluster.quotes.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft border-t border-line-soft">
          {visible.map((q) => (
            <li key={q.id} className="py-2">
              <div className="text-sm font-medium text-mute-soft">
                {q.participant_name}
              </div>
              <p className="mt-0.5 text-md leading-[1.55] text-ink-2">
                {q.text}
              </p>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && !expanded && (
        <div className="mt-2">
          <Button variant="link" size="xs" onClick={() => setExpanded(true)}>
            +{hidden}개 더 보기
          </Button>
        </div>
      )}
      {expanded && cluster.quotes.length > PREVIEW_QUOTES && (
        <div className="mt-2">
          <Button variant="link" size="xs" onClick={() => setExpanded(false)}>
            접기
          </Button>
        </div>
      )}
    </div>
  );
}

export function ClusterView({ clusters }: { clusters: ClusterWithQuotes[] }) {
  if (clusters.length === 0) {
    return (
      <p className="text-sm leading-[1.55] text-mute-soft">
        이 분석에는 클러스터 데이터가 없습니다 (PR 5a 이전 생성된 분석은
        새 분석으로 다시 실행하면 자동 생성됩니다).
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {clusters.map((c) => (
        <ClusterCard key={c.id} cluster={c} />
      ))}
    </div>
  );
}
