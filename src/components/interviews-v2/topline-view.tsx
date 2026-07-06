'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { ToplineBlock } from '@/lib/interview-v2/types';
import { useInterviewTopline } from '@/hooks/use-interview-topline';

// 인터뷰 탑라인 보고서 — 우측 패널 탭1. interview_toplines.blocks 를 보고서
// 톤으로 렌더한다. 각 블록은 data-block-id 를 노출해 후속 drag-to-ask 가
// "이 블록 아래 삽입"을 anchor 로 잡을 수 있게 한다 (사용자 결정 #2 — DOM 계약).
//
// 상태(GET status + stale): generating=skeleton, done=blocks, stale=배너+
// 기존 보고서 유지, error/none=CTA. 재생성은 탭 헤더 우측 버튼(명시적 — Opus 비용).
//
// 인용: 블록의 citations 는 chunk_id 뿐(원문 excerpt 는 topline payload 에
// 없음)이라, inline [n] 을 기존 인용 뱃지 톤의 정적 뱃지로 렌더한다. 원문
// popover 는 excerpt 를 함께 싣는 후속 작업으로 분리(보수적 스코프).

// inline [123] (markdown link [123](url) 제외) — qa-pair 와 동일 규칙.
function citeToken(): RegExp {
  return /\[(\d+)\](?!\()/g;
}

// 렌더 가능한 chunk_id 만 앵커 링크로 치환 → a 컴포넌트가 뱃지로 스왑.
function withCiteLinks(md: string, valid: Set<string>): string {
  return md.replace(citeToken(), (full, id: string) =>
    valid.has(id) ? `[${id}](#cite-${id})` : full,
  );
}

// paragraph/insight/inserted_qa 의 markdown 컴포넌트 — 보고서 톤(디자인 토큰).
// 인용 앵커(#cite-)는 비대화형 뱃지로, 그 외 링크는 일반 링크로.
function useMarkdownComponents(): Components {
  return useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        if (href && href.startsWith('#cite-')) {
          return (
            <span className="mx-0.5 inline-flex select-none items-center rounded-xs border border-amore bg-amore-bg px-1 align-baseline text-xs-soft font-semibold text-amore">
              {children}
            </span>
          );
        }
        return (
          <a
            href={href ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
          >
            {children}
          </a>
        );
      },
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
  const processed = useMemo(() => withCiteLinks(md, valid), [md, valid]);
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {processed}
    </ReactMarkdown>
  );
}

function BlockView({ block }: { block: ToplineBlock }) {
  // 모든 블록은 data-block-id 로 anchor 노출 (drag-to-ask DOM 계약).
  const common = { 'data-block-id': block.id } as const;

  if (block.type === 'heading') {
    return (
      <h2
        {...common}
        className="mb-2 mt-7 border-b border-line-soft pb-2 text-lg font-semibold text-ink first:mt-0"
      >
        {block.md}
      </h2>
    );
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
    // 후속 drag-to-ask 가 병합하는 삽입 Q&A — Q 라벨 + A 본문 + 인용.
    return (
      <div
        {...common}
        className="my-3 rounded-sm border border-line bg-paper px-4 py-3"
      >
        {block.question && (
          <div className="mb-2 flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-amore">
              Q
            </span>
            <p className="text-md font-medium leading-[1.6] text-ink-2">
              {block.question}
            </p>
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

function GeneratingSkeleton() {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        {t('toplineGenerating')}
      </div>
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
    status,
    blocks,
    stale,
    indexed,
    loading,
    fetchError,
    generating,
    generate,
  } = useInterviewTopline(projectId);

  const hasBlocks = blocks.length > 0;
  // 재생성 버튼 활성 = 인덱싱 완료 & 생성 중 아님.
  const canGenerate = indexed && status !== 'generating' && !generating;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭 헤더 우측 = 재생성 버튼 (명시적 — Opus 비용). blocks 가 이미 있을
          때만 노출(최초 생성은 본문 CTA 가 담당). */}
      {hasBlocks && (
        <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-6 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {t('toplineReportLabel')}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void generate(true)}
            disabled={!canGenerate}
            title={t('toplineRegenerate')}
          >
            🔄 {t('toplineRegenerate')}
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
          <GeneratingSkeleton />
        ) : hasBlocks ? (
          <>
            {/* 생성 중이지만 이전 보고서가 남아 있으면 상단에 진행 표시. */}
            {status === 'generating' && (
              <div className="mb-4 flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                {t('toplineGenerating')}
              </div>
            )}
            {stale && status !== 'generating' && (
              <StaleBanner
                onRegenerate={() => void generate(true)}
                disabled={!canGenerate}
              />
            )}
            <article>
              {blocks.map((b) => (
                <BlockView key={b.id} block={b} />
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
              <Button
                variant="primary"
                size="sm"
                className="mt-5"
                onClick={() => void generate(false)}
                disabled={!canGenerate}
              >
                {t('toplineGenerateCta')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
