'use client';

import { Tooltip } from '@/components/ui/tooltip';
import { useInterviewV2TrustStats } from '@/hooks/use-interview-v2-trust-stats';

// Interview V2 — 신뢰도 (trust) detail panel, option B.
//
// A collapsed-by-default <details> under the project file list. The summary
// row shows the headline reassurance numbers (files · chunks · embed %);
// expanding reveals the data-accuracy section plus the 7-layer
// hallucination-guard list, each layer carrying an ⓘ tooltip with the
// detail behind it.
//
// Copy is kept as an inline ko-only constant (mirroring the spec) rather
// than i18n keys: this is one of three competing trust-UX experiments
// (A/B/C) and keeping it out of the messages/*.json hotspot avoids merge
// conflicts with the sibling experiments. If option B is adopted, the copy
// moves to messages/{ko,en}.json in the follow-up.

type Layer = { id: string; title: string; detail: string };

const LAYERS: Layer[] = [
  {
    id: 'retrieval-first',
    title: '근거 청크 밖 정보 생성 금지',
    detail:
      'LLM system prompt 에 "일반 상식·추측·외부 지식 금지" 명시. 오직 인덱싱된 원문만 답변 근거로 사용합니다.',
  },
  {
    id: 'threshold',
    title: '유사도 임계값 0.2 (관련 없는 청크 drop)',
    detail:
      '실 prod 데이터로 튜닝한 값 (0.19 이하 = orthogonal noise). 관련성이 부족한 청크를 pgvector 레벨에서 걸러냅니다.',
  },
  {
    id: 'inline-citation',
    title: '인라인 [citation] 필수',
    detail:
      'LLM 이 모든 사실 주장 뒤에 [chunk_id] inline citation 을 붙이도록 강제합니다. 근거 없이 서술하지 않습니다.',
  },
  {
    id: 'server-reconstruct',
    title: '서버 재구성 (환상 citation drop)',
    detail:
      'LLM 이 존재하지 않는 chunk_id 를 인용해도 서버가 실제 hits 와 매칭 후 없는 것은 drop 합니다. 사용자가 보는 근거 = 100% 실 원문.',
  },
  {
    id: 'no-answer',
    title: '근거 없으면 "찾지 못했습니다" fallback',
    detail:
      '근거 청크로 답할 수 없으면 "이 질문에 대한 근거를 찾지 못했습니다" 를 강제 반환합니다. 지어내지 않습니다.',
  },
  {
    id: 'zero-retention',
    title: 'Zero retention (외부 서버 저장 X)',
    detail: 'Anthropic 서버에 데이터를 저장하지 않습니다 (providerOptions.zero_retention).',
  },
  {
    id: 'temp',
    title: 'Temperature 0.1 (deterministic)',
    detail: 'creative hallucination 을 최소화합니다. Deterministic 답변을 우선합니다.',
  },
];

export function TrustDetailPanel({ projectId }: { projectId: string }) {
  const { stats, isLoading } = useInterviewV2TrustStats(projectId);
  const fileCount = stats?.fileCount ?? 0;
  const chunkCount = stats?.chunkCount ?? 0;
  const embedPct = Math.round((stats?.embedRate ?? 1) * 100);

  return (
    <details className="border-t border-line-soft">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm text-ink-2 transition-colors hover:bg-amore-bg">
        <span className="select-none text-mute">▸ </span>
        🛡 신뢰도
        {isLoading ? (
          <span className="text-mute"> · 집계 중…</span>
        ) : (
          <span className="text-mute">
            {' '}
            · 파일 {fileCount} · 청크 {chunkCount} · {embedPct}%
          </span>
        )}
      </summary>

      <div className="space-y-4 bg-paper-soft px-4 py-4">
        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink-2">📄 데이터 정확성</h4>
          <ul className="space-y-1 text-sm text-mute">
            <li>
              ✅ 파일 {fileCount}개 · 청크 {chunkCount}개 · 임베딩 {embedPct}%
            </li>
            <li>✅ 원문 무손실 (chunk 1800자 안전 마진 18배)</li>
          </ul>
        </section>

        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink-2">🛡 환각 방지 7-layer</h4>
          <ol className="space-y-2 text-sm text-mute">
            {LAYERS.map((l, i) => (
              <li key={l.id} className="flex items-start gap-2">
                <span className="shrink-0 tabular-nums text-mute-soft">{i + 1}.</span>
                <span className="flex-1">{l.title}</span>
                <Tooltip content={l.detail}>
                  <span className="cursor-help text-mute" aria-label={l.title}>
                    ⓘ
                  </span>
                </Tooltip>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </details>
  );
}
