'use client';

/* ────────────────────────────────────────────────────────────────────
   topline-blocks — 인터뷰 탑라인 보고서 블록의 **순수 렌더 SSOT**.

   원래 topline-view.tsx 안에 있던 BlockView / Prose / ToplineChartBlock 을
   여기로 추출한다. 이유: 공유 뷰어(#476)가 탑라인을 read-only 로 렌더할 때
   같은 블록 렌더를 재사용해야 하는데(결정 1), topline-view.tsx 전체를 import
   하면 편집/드래그/재생성 훅(useInterviewTopline, drag-to-ask 등)이 공유
   번들로 딸려온다. 렌더만 담은 이 모듈을 분리하면 편집 진입점 0 을 지키면서
   렌더 로직 복붙 없이 SSOT 를 공유한다.

   topline-view.tsx(편집 가능한 우측 패널)와 share-viewer-frame(read-only 공유)
   양쪽이 여기 BlockView 를 import 한다 — 렌더 결과 불일치 0.
   ──────────────────────────────────────────────────────────────────── */

import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ToplineBlock } from '@/lib/interview-v2/types';

// 인용 표기: 사용자 결정 1 — 문장 흐름을 깨던 빨간 [chunk_id] 숫자 뱃지를
// 제거한다. 블록의 citations(chunk_id)는 서버 재검증·docx "근거: 문서명" 각주에
// 여전히 쓰이지만, 화면에서는 raw 숫자를 노출하지 않는다. md 본문에 섞인 inline
// [chunk_id] 토큰은 렌더 전에 제거한다(docx stripInlineCitations 와 동일 규칙).
function stripCiteTokens(md: string, cited: Set<string>): string {
  return md
    .replace(/\s*\[([^\]\n]+)\](?!\()/g, (full, tok: string) =>
      cited.has(tok.trim()) ? '' : full,
    )
    .replace(/[ \t]+([.,;:?!、。])/g, '$1');
}

// paragraph/insight/inserted_qa 의 markdown 컴포넌트 — 보고서 톤(디자인 토큰).
// 인용 뱃지는 제거됐다(사용자 결정 1). 남는 링크는 일반 링크로만 렌더.
function useMarkdownComponents(): Components {
  return useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <a
          href={href ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="break-words text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
        >
          {children}
        </a>
      ),
      p: ({ children }) => (
        <p className="my-1.5 text-md leading-[1.7] text-ink-2">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="my-1.5 list-disc space-y-1 pl-5 text-md leading-[1.7] marker:text-mute-soft">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="my-1.5 list-decimal space-y-1 pl-5 text-md leading-[1.7] marker:text-mute-soft">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="text-ink-2">{children}</li>,
      strong: ({ children }) => (
        <strong className="font-semibold text-ink">{children}</strong>
      ),
    }),
    [],
  );
}

export function Prose({ md, citations }: { md: string; citations?: string[] }) {
  const components = useMarkdownComponents();
  const valid = useMemo(
    () => new Set((citations ?? []).map((c) => String(c))),
    [citations],
  );
  const processed = useMemo(() => stripCiteTokens(md, valid), [md, valid]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {processed}
    </ReactMarkdown>
  );
}

// chart/pie 블록 렌더 — answer-artifact-renderer(#696) 와 동일한 recharts +
// 디자인 토큰 색 팔레트. 탑라인 블록 shape({title, chartKind, data:[{label,value}]})
// 에 맞춘 경량 컴포넌트. bar/line/pie 지원.
const TOPLINE_CHART_COLORS = [
  'var(--color-amore)',
  'var(--color-ink)',
  'var(--color-mute)',
  '#f97316',
  '#a855f7',
];

function ToplineChartBlock({
  block,
  common,
}: {
  block: ToplineBlock;
  common: { 'data-block-id': string };
}) {
  const data = (block.data ?? []).map((d) => ({ name: d.label, value: d.value }));
  const isPie = block.type === 'pie';
  const kind = isPie ? 'pie' : (block.chartKind ?? 'bar');
  const icon = isPie ? '🥧' : kind === 'line' ? '📈' : '📊';

  return (
    <div
      {...common}
      className="my-3 rounded-sm border border-line-soft bg-paper-soft p-3"
    >
      {block.title && (
        <h4 className="mb-2 text-sm font-semibold text-ink-2">
          {icon} {block.title}
        </h4>
      )}
      {block.description && (
        <p className="mb-2 text-xs-soft text-mute">{block.description}</p>
      )}
      {data.length > 0 ? (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {kind === 'pie' ? (
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  label={(entry) => `${entry.name} (${entry.value})`}
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={TOPLINE_CHART_COLORS[i % TOPLINE_CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            ) : kind === 'line' ? (
              <LineChart data={data}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-amore)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            ) : (
              <BarChart data={data}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value">
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={TOPLINE_CHART_COLORS[i % TOPLINE_CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

// 탑라인 블록 하나 렌더 — heading/subheading/executive_summary/quote/table/
// chart/pie/inserted_qa/paragraph/insight. 편집·드래그 로직은 여기 없다(순수
// 표시). data-block-id 는 편집 뷰의 drag-to-ask anchor 계약이라 유지하지만,
// 공유 뷰어처럼 drag 훅이 없는 곳에서는 단순 DOM 속성이라 무해하다.
export function ToplineBlockView({ block }: { block: ToplineBlock }) {
  const common = { 'data-block-id': block.id } as const;

  if (block.type === 'executive_summary') {
    const summary = block.summary?.trim() ?? '';
    const keyPoints = (block.key_points ?? [])
      .map((p) => p.trim())
      .filter(Boolean);
    if (!summary && keyPoints.length === 0) return null;
    return (
      <section
        {...common}
        className="mb-6 rounded-sm border border-line-soft bg-paper-soft px-5 py-4"
      >
        {summary && <Prose md={summary} citations={block.citations} />}
        {keyPoints.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-md leading-[1.7] text-ink-2 marker:text-mute-soft">
            {keyPoints.map((point, i) => (
              <li key={i} className="text-ink-2">
                {point}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (block.type === 'heading') {
    return (
      <h2
        {...common}
        className="mb-3 mt-8 border-b border-line pb-2 text-xl font-semibold tracking-tight text-ink first:mt-0"
      >
        {block.md}
      </h2>
    );
  }

  if (block.type === 'subheading') {
    return (
      <h3
        {...common}
        className="mb-1.5 mt-5 text-md font-semibold text-ink-2"
      >
        {block.md}
      </h3>
    );
  }

  if (block.type === 'chart' || block.type === 'pie') {
    return <ToplineChartBlock block={block} common={common} />;
  }

  if (block.type === 'quote') {
    return (
      <blockquote
        {...common}
        className="my-3 border-l-2 border-amore bg-amore-bg px-4 py-2"
      >
        <p className="whitespace-pre-wrap text-md italic leading-[1.7] text-ink-2">
          {block.md}
        </p>
        {block.attribution && (
          <p className="mt-1.5 text-xs-soft text-mute">— {block.attribution}</p>
        )}
      </blockquote>
    );
  }

  if (block.type === 'table' && block.table) {
    const { headers, rows } = block.table;
    return (
      <div
        {...common}
        className="my-3 rounded-sm border border-line-soft bg-paper-soft p-3"
      >
        {block.md && (
          <h4 className="mb-2 text-sm font-semibold text-ink-2">📊 {block.md}</h4>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-soft">
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr
                  key={r}
                  className="border-b border-line-soft last:border-b-0"
                >
                  {row.map((cell, c) => (
                    <td key={c} className="px-2 py-1.5 align-top text-ink-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (block.type === 'inserted_qa') {
    // drag-to-ask 가 병합한 삽입 Q&A — Q 라벨(선택 발췌 포함) + A 본문 + 인용.
    // 좌 amore 보더로 본문과 미묘히 구분(사용자 결정 §D, 디자인 토큰 내).
    return (
      <div
        {...common}
        className="my-3 rounded-sm border border-line border-l-2 border-l-amore bg-paper px-4 py-3"
      >
        {block.question && (
          <div className="mb-2 flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-amore">
              Q
            </span>
            <div className="min-w-0">
              <p className="text-md font-medium leading-[1.6] text-ink-2">
                {block.question}
              </p>
              {block.selected_excerpt && (
                <p className="mt-1 line-clamp-2 text-xs-soft italic text-mute">
                  “{block.selected_excerpt}”
                </p>
              )}
            </div>
          </div>
        )}
        {block.md && <Prose md={block.md} citations={block.citations} />}
      </div>
    );
  }

  if (block.type === 'inserted_section') {
    // 섹션 사이 삽입 UX 로 생성한 섹션 — 좌 amore 보더 + ✚ 칩으로 사용자 삽입임을
    // 표시(inserted_qa 와 같은 계열, 디자인 토큰 내). 본문은 생성된 md 프로즈
    // (첫 줄 굵은 제목 포함). i18n 미사용 — 공유 뷰어 재사용 위해 로케일 중립 칩.
    return (
      <section
        {...common}
        className="my-3 rounded-sm border border-line border-l-2 border-l-amore bg-paper px-4 py-3"
      >
        <div className="mb-1.5">
          <span className="inline-block rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-amore">
            ✚
          </span>
        </div>
        <Prose md={block.md ?? ''} citations={block.citations} />
      </section>
    );
  }

  // paragraph · insight (기본) — insight 는 교차분석 대조라 살짝 강조.
  const isInsight = block.type === 'insight';
  return (
    <div
      {...common}
      className={
        isInsight
          ? 'my-2 rounded-sm border-l-2 border-line px-3 py-1'
          : 'my-2'
      }
    >
      <Prose md={block.md ?? ''} citations={block.citations} />
    </div>
  );
}

// 탑라인 보고서 블록 리스트를 통째로 read-only 렌더. 공유 뷰어(#476)가 편집
// 컨트롤 없이 블록만 그릴 때 쓴다. 편집 뷰(topline-view.tsx)는 블록 사이에
// pending Q&A/편집기를 끼워야 해서 이 래퍼 대신 ToplineBlockView 를 직접 map 한다.
export function ReadonlyToplineBlocks({ blocks }: { blocks: ToplineBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <article>
      {blocks.map((b) => (
        <ToplineBlockView key={b.id} block={b} />
      ))}
    </article>
  );
}
