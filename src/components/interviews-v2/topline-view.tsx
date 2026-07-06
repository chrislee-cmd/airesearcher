'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast-provider';
import type { ToplineBlock } from '@/lib/interview-v2/types';
import { useInterviewTopline } from '@/hooks/use-interview-topline';
import {
  useToplineDragToAsk,
  type PendingQa,
} from '@/hooks/use-topline-drag-to-ask';
import { useToplineSelection, ToplineAskPopup } from './topline-selection';

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
          {qa.selectedExcerpt && (
            <p className="mt-1 line-clamp-2 text-xs-soft italic text-mute">
              “{qa.selectedExcerpt}”
            </p>
          )}
        </div>
      </div>

      {errored ? (
        <p className="text-sm text-warning">
          {t('toplineAskError')}
          {qa.errorMsg ? ` (${qa.errorMsg})` : ''}
        </p>
      ) : qa.answerMd ? (
        <Prose md={qa.answerMd} citations={qa.citations} />
      ) : (
        <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
          {t('toplineAskThinking')}
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
    refetch,
  } = useInterviewTopline(projectId);

  const hasBlocks = blocks.length > 0;
  // 재생성 버튼 활성 = 인덱싱 완료 & 생성 중 아님.
  const canGenerate = indexed && status !== 'generating' && !generating;

  // drag-to-ask — 보고서가 done 으로 렌더 중일 때만 선택 활성.
  const askEnabled =
    hasBlocks && !loading && !fetchError && indexed && status !== 'generating';
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selection, clear } = useToplineSelection(scrollRef, askEnabled);
  const dta = useToplineDragToAsk({ projectId, onMerged: refetch });

  // 재생성 시 삽입 Q&A 유실 경고(사용자 결정 3) — inserted_qa 가 하나라도
  // 있을 때만 confirm modal 을 거친다.
  const hasInsertedQa = blocks.some((b) => b.type === 'inserted_qa');
  const [warnOpen, setWarnOpen] = useState(false);
  const requestRegenerate = () => {
    if (hasInsertedQa) setWarnOpen(true);
    else void generate(true);
  };

  // Word 다운로드 = attachment GET 으로 브라우저 다운로드(쿠키 포함 네비게이션).
  const toast = useToast();
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
                onRegenerate={requestRegenerate}
                disabled={!canGenerate}
              />
            )}
            <article>
              {blocks.map((b) => (
                <Fragment key={b.id}>
                  <BlockView block={b} />
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

      {/* 선택 → 질문 입력 팝업. key 로 새 선택마다 입력 초기화. */}
      {askEnabled && selection && (
        <ToplineAskPopup
          key={`${selection.anchorBlockId}:${selection.text}`}
          selection={selection}
          busy={false}
          onSubmit={(q) => {
            void dta.ask(selection.anchorBlockId, selection.text, q);
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
                void generate(true);
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
