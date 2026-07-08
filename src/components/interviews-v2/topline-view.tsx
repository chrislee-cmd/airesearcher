'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
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
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { SelectMenu } from '@/components/ui/select-menu';
import { ShareInviteButton } from '@/components/share/share-invite-button';
import { useToast } from '@/components/toast-provider';
import {
  isEditableToplineBlockType,
  type ToplineBlock,
} from '@/lib/interview-v2/types';
import { useInterviewTopline } from '@/hooks/use-interview-topline';

// 출력 언어 선택 옵션 — SSOT 는 topline-prompt.ts 의 TOPLINE_OUTPUT_LANGS
// (zod enum) / TOPLINE_DEFAULT_LANG. 여기선 서버 프롬프트 모듈을 client 번들에
// 끌어오지 않으려 라벨만 로컬로 미러한다(값은 반드시 동기 유지). 라벨은 각
// 언어의 자기표기 — locale 무관하게 통용.
const TOPLINE_LANG_OPTIONS = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
] as const;
const TOPLINE_DEFAULT_LANG = 'ko';
import {
  useToplineDragToAsk,
  type PendingQa,
} from '@/hooks/use-topline-drag-to-ask';
import { useToplineEdit } from '@/hooks/use-topline-edit';
import { useToplineSelection, ToplineAskPopup } from './topline-selection';

// 인터뷰 탑라인 보고서 — 우측 패널 탭1. interview_toplines.blocks 를 보고서
// 톤으로 렌더한다. 각 블록은 data-block-id 를 노출해 후속 drag-to-ask 가
// "이 블록 아래 삽입"을 anchor 로 잡을 수 있게 한다 (사용자 결정 #2 — DOM 계약).
//
// 상태(GET status + stale): generating=skeleton, done=blocks, stale=배너+
// 기존 보고서 유지, error/none=CTA. 재생성은 탭 헤더 우측 버튼(명시적 — Opus 비용).
//
// 인용 표기: 사용자 결정 1 — 문장 흐름을 깨던 빨간 [chunk_id] 숫자 뱃지를
// 제거한다. 블록의 citations(chunk_id)는 서버 재검증·docx "근거: 문서명" 각주에
// 여전히 쓰이지만, 화면에서는 raw 숫자를 노출하지 않는다. md 본문에 섞인 inline
// [chunk_id] 토큰은 렌더 전에 제거한다(docx stripInlineCitations 와 동일 규칙).
// 원문 근거는 docx/Google Docs export 의 각주로 추적 가능하다(보수적 스코프).
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

function Prose({ md, citations }: { md: string; citations?: string[] }) {
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

function BlockView({ block }: { block: ToplineBlock }) {
  const tView = useTranslations('InterviewsV2');
  // 모든 블록은 data-block-id 로 anchor 노출 (drag-to-ask DOM 계약).
  const common = { 'data-block-id': block.id } as const;

  if (block.type === 'executive_summary') {
    // 보고서 리드 — 카드 abstract 와 동일 소스(summary + 핵심 포인트)를 fullview
    // 상단에 강조 렌더(카드=fullview 일관, 결정 2). 첫 블록이라 자연스레 리드로
    // 위치한다. amore 액센트 좌 보더 + paper-soft 배경(디자인 토큰).
    const summary = block.summary?.trim() ?? '';
    const keyPoints = (block.key_points ?? [])
      .map((p) => p.trim())
      .filter(Boolean);
    if (!summary && keyPoints.length === 0) return null;
    return (
      <section
        {...common}
        className="mb-6 rounded-sm border border-line-soft border-l-2 border-l-amore bg-paper-soft px-5 py-4"
      >
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
          {tView('toplineExecSummaryLabel')}
        </div>
        {summary && <Prose md={summary} citations={block.citations} />}
        {keyPoints.length > 0 && (
          <ul className="mt-2.5 space-y-1.5">
            {keyPoints.map((point, i) => (
              <li
                key={i}
                className="flex gap-2 text-md leading-[1.6] text-ink-2"
              >
                <span aria-hidden className="mt-[0.1em] shrink-0 text-amore">
                  ▪
                </span>
                <span className="min-w-0">{point}</span>
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

// drag-to-ask pending 삽입 카드 — anchor 블록 바로 아래에 스트리밍 답변을
// 렌더한다. pending 은 옅은 배경 + 점선 테두리로 확정 블록과 시각 구분(사용자
// 결정 flow 3). 스트리밍 완료 시 [✓ 유지][✕ 버리기], 에러 시 버리기만.
function PendingQaCard({
  qa,
  onKeep,
  onDiscard,
}: {
  qa: PendingQa;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const streaming = qa.phase === 'streaming';
  const errored = qa.phase === 'error';
  return (
    <div
      aria-busy={streaming}
      className={`my-3 rounded-sm border-l-2 border-l-amore px-4 py-3 ${
        streaming
          ? 'border border-dashed border-line bg-paper-soft'
          : errored
            ? 'border border-warning bg-warning-bg'
            : 'border border-line bg-paper'
      }`}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-amore">
          Q
        </span>
        <div className="min-w-0">
          <p className="text-md font-medium leading-[1.6] text-ink-2">
            {qa.question}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* 근거 소스 배지 — 웹 답변임을 명시해 인터뷰 데이터와 혼동 방지. */}
            <span className="shrink-0 rounded-xs border border-line-soft px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-mute-soft">
              {qa.mode === 'web'
                ? `🌐 ${t('toplineAskModeWeb')}`
                : `📚 ${t('toplineAskModeInterview')}`}
            </span>
            {qa.selectedExcerpt && (
              <p className="line-clamp-2 min-w-0 text-xs-soft italic text-mute">
                “{qa.selectedExcerpt}”
              </p>
            )}
          </div>
        </div>
      </div>

      {errored ? (
        <p className="text-sm text-warning">
          {qa.errorMsg === 'web_search_unavailable'
            ? t('toplineAskWebUnavailable')
            : `${t('toplineAskError')}${qa.errorMsg ? ` (${qa.errorMsg})` : ''}`}
        </p>
      ) : qa.answerMd ? (
        <Prose md={qa.answerMd} citations={qa.citations} />
      ) : (
        <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
          {qa.mode === 'web'
            ? t('toplineAskThinkingWeb')
            : t('toplineAskThinking')}
        </div>
      )}

      {(qa.phase === 'done' || errored) && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft pt-2">
          {qa.phase === 'done' && (
            <Button
              variant="primary"
              size="xs"
              onClick={onKeep}
              disabled={qa.saving}
            >
              ✓ {t('toplineAskKeep')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={onDiscard}
            disabled={qa.saving}
          >
            ✕ {t('toplineAskDiscard')}
          </Button>
        </div>
      )}
    </div>
  );
}

// 인라인 블록 편집기 — 선택 블록의 md 를 plain textarea 로 열어 내용만 수정한다
// (스타일 X — 사용자 결정 1·3). 저장 = 낙관적 반영 + PATCH(edit_block), 취소 =
// 원문 유지(편집 모드만 닫음). 변경 없거나 빈 내용이면 저장은 취소처럼 동작.
function BlockEditor({
  initialMd,
  saving,
  onSave,
  onCancel,
}: {
  initialMd: string;
  saving: boolean;
  onSave: (nextMd: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [draft, setDraft] = useState(initialMd);
  const unchanged = draft.trim() === initialMd.trim();

  return (
    <div className="my-2 rounded-sm border border-ink bg-paper p-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
        autoFocus
        disabled={saving}
        aria-label={t('toplineEditAction')}
      />
      <p className="mt-1.5 text-xs-soft text-mute-soft">{t('toplineEditHint')}</p>
      <div className="mt-2 flex items-center justify-end gap-2 border-t border-line-soft pt-2">
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={saving}>
          {t('toplineEditCancel')}
        </Button>
        <Button
          variant="primary"
          size="xs"
          onClick={() => onSave(draft)}
          disabled={saving || unchanged || draft.trim().length === 0}
        >
          {t('toplineEditSave')}
        </Button>
      </div>
    </div>
  );
}

function StaleBanner({
  onRegenerate,
  disabled,
}: {
  onRegenerate: () => void;
  disabled: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amore bg-amore-bg px-4 py-3">
      <span className="text-md text-ink-2">{t('toplineStaleBanner')}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={onRegenerate}
        disabled={disabled}
      >
        {t('toplineRegenerate')}
      </Button>
    </div>
  );
}

// map-reduce 진행률 — 전 문서 순회 중 "N/M 문서 분석" + 진행 바. map_total 이
// 없으면(레거시/시작 전) 아무것도 그리지 않는다. 이 문구가 "빠짐없이 전 문서를
// 읽는 중"을 사용자에게 보이게 해 긴 생성 시간을 납득시킨다(카드 #430).
// export — 위젯 카드 본문(interviews-card)이 팝업 밖 ambient 진행률로 재사용한다
// (로직 복붙 금지, card #434). 여기가 SSOT.
export function ToplineMapProgress({
  mapTotal,
  mapDone,
}: {
  mapTotal?: number | null;
  mapDone?: number | null;
}) {
  const t = useTranslations('InterviewsV2');
  if (!mapTotal || mapTotal <= 0) return null;
  const done = Math.max(0, Math.min(mapDone ?? 0, mapTotal));
  const pct = Math.round((done / mapTotal) * 100);
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-mute">
        {t('toplineMapProgress', { done, total: mapTotal })}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full rounded-full bg-amore transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// reduce(보고서 작성) 진행 신호 — map(N/M) 이 끝나고 streamObject 가 블록을
// 스트리밍하는 동안 "보고서 작성 중… (N블록)" 을 노출한다. blockCount 는 지금까지
// 도착한 부분 블록 수. count 가 0 이면(첫 블록 도착 전) 수치 없는 문구만 그린다.
// export — 카드 ambient 밴드(interviews-card)가 팝업 밖에서 재사용한다. 여기가 SSOT.
export function ToplineReduceProgress({
  blockCount,
}: {
  blockCount?: number | null;
}) {
  const t = useTranslations('InterviewsV2');
  const count = Math.max(0, blockCount ?? 0);
  return (
    <div className="flex items-center gap-2 text-sm text-mute">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
      {count > 0
        ? t('toplineReduceProgress', { count })
        : t('toplineReduceProgressStart')}
    </div>
  );
}

function GeneratingSkeleton({
  mapTotal,
  mapDone,
  inReduce,
  blockCount,
}: {
  mapTotal?: number | null;
  mapDone?: number | null;
  inReduce?: boolean;
  blockCount?: number | null;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        {t('toplineGenerating')}
      </div>
      {/* map 순회 중이면 N/M, map 이 끝나고 reduce 스트리밍 중이면 "작성 중(N블록)". */}
      {inReduce ? (
        <ToplineReduceProgress blockCount={blockCount} />
      ) : (
        <ToplineMapProgress mapTotal={mapTotal} mapDone={mapDone} />
      )}
      <Skeleton className="h-6 w-1/3 rounded-sm" />
      <Skeleton className="h-24 w-full rounded-sm" />
      <Skeleton className="h-6 w-1/4 rounded-sm" />
      <Skeleton className="h-32 w-full rounded-sm" />
    </div>
  );
}

export function ToplineView({ projectId }: { projectId: string }) {
  const t = useTranslations('InterviewsV2');
  const {
    toplineId,
    status,
    blocks,
    stale,
    indexed,
    loading,
    fetchError,
    generating,
    generate,
    refetch,
    applyBlockMd,
    mapTotal,
    mapDone,
    savedLang,
  } = useInterviewTopline(projectId);

  const toast = useToast();
  const hasBlocks = blocks.length > 0;
  // 재생성 버튼 활성 = 인덱싱 완료 & 생성 중 아님.
  const canGenerate = indexed && status !== 'generating' && !generating;

  // reduce 단계 감지 — map(전 문서 순회)이 끝나면(map_done ≥ map_total) reduce
  // (보고서 작성)로 넘어간다. 이때 streamObject 가 blocks 를 증분 스트리밍하므로
  // "보고서 작성 중… (N블록)" 신호를 노출한다. map_total 이 없으면(레거시) map
  // 진행률 자체를 안 그리므로 reduce 신호도 skip.
  const mapComplete = !!mapTotal && (mapDone ?? 0) >= mapTotal;
  const inReduce = status === 'generating' && mapComplete;

  // 출력 언어 선택(입력 transcript 언어와 독립 — 사용자 결정 1). 기본 = 한국어.
  // 저장된 보고서가 있으면 그 언어로 초기화(GET 이 output_lang 반환)해, 사용자가
  // 마지막에 고른 언어를 선택기에 반영한다. 언어를 바꿔 재생성하면 캐시가
  // 안 걸리고(결정 3) 새 언어로 다시 생성된다.
  const [outputLang, setOutputLang] = useState<string>(TOPLINE_DEFAULT_LANG);
  useEffect(() => {
    // GET 이 저장된 언어를 실어오면 선택기를 그 값으로 초기화(사용자가 마지막에
    // 고른 언어 반영). 이후 사용자가 자유롭게 바꿀 수 있고, 재생성 완료 시
    // savedLang 이 새 값으로 갱신돼도 동일 값이라 무해.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selector to server-persisted lang on load (use-interview-topline savedLang)
    if (savedLang) setOutputLang(savedLang);
  }, [savedLang]);

  // drag-to-ask — 보고서가 done 으로 렌더 중일 때만 선택 활성.
  const askEnabled =
    hasBlocks && !loading && !fetchError && indexed && status !== 'generating';
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selection, clear } = useToplineSelection(scrollRef, askEnabled);
  const dta = useToplineDragToAsk({ projectId, onMerged: refetch });

  // 인라인 편집 — 현재 편집 중인 블록 id + 저장 오케스트레이션(낙관 + 롤백).
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const edit = useToplineEdit({ projectId, applyBlockMd, onSaved: refetch });

  // 팝업 "편집" 액션 가용성 — 선택 블록이 텍스트 블록일 때만(table/chart/pie 제외).
  const selectionBlock = selection
    ? blocks.find((b) => b.id === selection.anchorBlockId)
    : undefined;
  const selectionEditable =
    !!selectionBlock && isEditableToplineBlockType(selectionBlock.type);

  const handleSaveEdit = async (
    blockId: string,
    prevMd: string,
    nextMd: string,
  ) => {
    // 변경 없음/빈 내용 → 서버 왕복 없이 편집만 닫는다(취소와 동일).
    if (!nextMd.trim() || nextMd.trim() === prevMd.trim()) {
      setEditingBlockId(null);
      return;
    }
    const result = await edit.save(blockId, prevMd, nextMd);
    if (result.ok) {
      setEditingBlockId(null);
      toast.push(t('toplineEditSaved'), { tone: 'amore' });
    } else {
      // 롤백은 hook 이 이미 수행 — 편집 모드는 유지해 재시도 가능.
      toast.push(`${t('toplineEditError')} (${result.error})`, { tone: 'warn' });
    }
  };

  // 재생성 시 삽입 Q&A 유실 경고(사용자 결정 3) — inserted_qa 가 하나라도
  // 있을 때만 confirm modal 을 거친다.
  const hasInsertedQa = blocks.some((b) => b.type === 'inserted_qa');
  const [warnOpen, setWarnOpen] = useState(false);
  const requestRegenerate = () => {
    if (hasInsertedQa) setWarnOpen(true);
    else void generate(true, outputLang);
  };

  // Word 다운로드 = attachment GET 으로 브라우저 다운로드(쿠키 포함 네비게이션).
  const downloadWord = () => {
    const a = document.createElement('a');
    a.href = `/api/interviews/v2/topline/export?project_id=${encodeURIComponent(
      projectId,
    )}&format=docx`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Google Docs 공유 = admin Drive 로 변환 업로드 → 링크 복사 + 새 탭.
  const [sharing, setSharing] = useState(false);
  const shareGoogleDocs = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch('/api/interviews/v2/topline/share-gdoc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !json?.url) {
        // #770 체계 reauth / 미구성 등은 서버 message 를 그대로 안내.
        const code = json?.error ?? `HTTP ${res.status}`;
        toast.push(
          code === 'admin_google_reauth_required' ||
            code === 'google_admin_not_configured'
            ? t('toplineShareUnavailable')
            : `${t('toplineShareError')} (${code})`,
          { tone: 'warn' },
        );
        return;
      }
      // 링크 복사(실패해도 새 탭은 연다).
      try {
        await navigator.clipboard.writeText(json.url);
        toast.push(t('toplineShareCopied'), { tone: 'amore' });
      } catch {
        toast.push(t('toplineShareOpened'), { tone: 'amore' });
      }
      window.open(json.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.push(
        `${t('toplineShareError')} (${e instanceof Error ? e.message : 'network'})`,
        { tone: 'warn' },
      );
    } finally {
      setSharing(false);
    }
  };

  const blockIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);
  const orphanPending = dta.pending.filter(
    (p) => !blockIds.has(p.anchorBlockId),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭 헤더 우측 = 재생성 버튼 (명시적 — Opus 비용). blocks 가 이미 있을
          때만 노출(최초 생성은 본문 CTA 가 담당). */}
      {hasBlocks && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-6 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {t('toplineReportLabel')}
          </span>
          <div className="flex items-center gap-2">
            {/* 분석 언어 — 재생성 시 이 언어로 강제(입력 파일 언어 독립). 언어를
                바꾸고 🔄 재생성하면 캐시 안 걸리고 새 언어로 재생성된다. */}
            <div className="w-[132px]">
              <SelectMenu
                value={outputLang}
                onChange={setOutputLang}
                options={TOPLINE_LANG_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                disabled={!canGenerate}
                aria-label={t('toplineLangLabel')}
              />
            </div>
            {/* export — 주 CTA 아님(quiet chrome). Word 다운로드 + Google Docs 공유. */}
            <ChromeButton size="sm" onClick={downloadWord} title={t('toplineExportWord')}>
              ⬇ {t('toplineExportWord')}
            </ChromeButton>
            <ChromeButton
              size="sm"
              onClick={() => void shareGoogleDocs()}
              disabled={sharing}
              title={t('toplineShareGdoc')}
            >
              {sharing ? `⏳ ${t('toplineSharing')}` : `📄 ${t('toplineShareGdoc')}`}
            </ChromeButton>
            {/* 링크로 공유(#477) — export(Google Docs) 와 구분되는 초대 게이트
                링크. 탑라인 row 가 생성된 뒤(toplineId) 활성화. */}
            <ShareInviteButton
              resourceType="interview_topline"
              resourceId={toplineId}
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={requestRegenerate}
              disabled={!canGenerate}
              title={t('toplineRegenerate')}
            >
              🔄 {t('toplineRegenerate')}
            </Button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <GeneratingSkeleton />
        ) : fetchError ? (
          <EmptyState
            tone="subtle"
            title={t('toplineLoadError')}
            description={fetchError}
          />
        ) : !indexed ? (
          <EmptyState tone="subtle" title={t('toplineNotIndexed')} />
        ) : status === 'generating' && !hasBlocks ? (
          <GeneratingSkeleton
            mapTotal={mapTotal}
            mapDone={mapDone}
            inReduce={inReduce}
            blockCount={blocks.length}
          />
        ) : hasBlocks ? (
          <>
            {/* 생성 중이면 상단에 진행 표시. map 순회 중엔 N/M, reduce(보고서
                작성) 중엔 "작성 중(N블록)". reduce 중엔 아래 <article> 의 blocks
                가 스트리밍으로 점진 렌더된다(부분/미완 블록은 서버가 접두만 보내
                graceful). */}
            {status === 'generating' && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                  {t('toplineGenerating')}
                </div>
                {inReduce ? (
                  <ToplineReduceProgress blockCount={blocks.length} />
                ) : (
                  <ToplineMapProgress mapTotal={mapTotal} mapDone={mapDone} />
                )}
              </div>
            )}
            {stale && status !== 'generating' && (
              <StaleBanner
                onRegenerate={requestRegenerate}
                disabled={!canGenerate}
              />
            )}
            <article>
              {blocks.map((b) => (
                <Fragment key={b.id}>
                  {editingBlockId === b.id ? (
                    // 편집 모드 — 블록 대신 인라인 textarea 로 md 수정.
                    <BlockEditor
                      initialMd={b.md ?? ''}
                      saving={edit.savingId === b.id}
                      onSave={(nextMd) =>
                        void handleSaveEdit(b.id, b.md ?? '', nextMd)
                      }
                      onCancel={() => setEditingBlockId(null)}
                    />
                  ) : (
                    <BlockView block={b} />
                  )}
                  {/* anchor 블록 바로 아래에 pending 삽입을 렌더. */}
                  {dta.pending
                    .filter((p) => p.anchorBlockId === b.id)
                    .map((p) => (
                      <PendingQaCard
                        key={p.id}
                        qa={p}
                        onKeep={() => void dta.keep(p)}
                        onDiscard={() => dta.discard(p.id)}
                      />
                    ))}
                </Fragment>
              ))}
              {/* anchor 를 못 찾은 orphan(그 사이 재생성 등) — 말미에. */}
              {orphanPending.map((p) => (
                <PendingQaCard
                  key={p.id}
                  qa={p}
                  onKeep={() => void dta.keep(p)}
                  onDiscard={() => dta.discard(p.id)}
                />
              ))}
            </article>
          </>
        ) : (
          // none / error / idle & 블록 없음 → 생성 시작 CTA.
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="max-w-[420px]">
              <h3 className="text-lg font-semibold text-ink-2">
                {status === 'error'
                  ? t('toplineErrorTitle')
                  : t('toplineIntroTitle')}
              </h3>
              <p className="mt-2 text-md text-mute">
                {status === 'error'
                  ? t('toplineErrorHint')
                  : t('toplineIntroHint')}
              </p>
              {/* 분석 언어 선택 — 입력 파일 언어와 독립(전사록 언어 트리거 미러
                  primitive = SelectMenu/ControlTrigger). 생성 CTA 바로 위에 둔다. */}
              <div className="mx-auto mt-5 flex max-w-[240px] flex-col items-start gap-1.5 text-left">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
                  {t('toplineLangLabel')}
                </span>
                <SelectMenu
                  value={outputLang}
                  onChange={setOutputLang}
                  options={TOPLINE_LANG_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  disabled={!canGenerate}
                  aria-label={t('toplineLangLabel')}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                className="mt-5"
                onClick={() => void generate(false, outputLang)}
                disabled={!canGenerate}
              >
                {t('toplineGenerateCta')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 선택 → 질문 입력 팝업. key 로 새 선택마다 입력 초기화. */}
      {askEnabled && selection && (
        <ToplineAskPopup
          key={`${selection.anchorBlockId}:${selection.text}`}
          selection={selection}
          busy={false}
          editable={selectionEditable}
          onEdit={() => {
            setEditingBlockId(selection.anchorBlockId);
            clear();
          }}
          onSubmit={(q, mode) => {
            void dta.ask(selection.anchorBlockId, selection.text, q, mode);
            clear();
          }}
          onClose={clear}
        />
      )}

      {/* 재생성 경고 — 삽입 Q&A 유실 명시 동의(사용자 결정 3). */}
      <Modal
        open={warnOpen}
        onClose={() => setWarnOpen(false)}
        size="sm"
        title={t('toplineRegenWarnTitle')}
        description={t('toplineRegenWarnBody')}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWarnOpen(false)}
            >
              {t('toplineRegenWarnCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setWarnOpen(false);
                void generate(true, outputLang);
              }}
            >
              {t('toplineRegenWarnConfirm')}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </div>
  );
}
