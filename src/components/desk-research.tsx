'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import Image from 'next/image';
import { useTranslations, useLocale } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';

function readActiveProjectId(): string | null {
  try {
    const raw = window.localStorage.getItem('active_project:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string } | null;
    return parsed?.id ?? null;
  } catch {
    return null;
  }
}
import { useDeskJobs, type DeskJob } from './desk-job-provider';
import { DeskAnalyticsPanel } from './desk-analytics-panel';
import { DownloadMenu } from './ui/download-menu';
import { ShareMenu } from './ui/share-menu';
import { EmptyState } from './ui/empty-state';
import { JobProgress } from './ui/job-progress';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { Modal } from './ui/modal';
import { Input } from './ui/input';
import { ChipInput } from './ui/chip-input';
import { triggerBlobDownload } from '@/lib/export/download';
import { buildArtifactBaseName } from '@/lib/filename';
import { prefillKey } from '@/lib/workspace';
import {
  DESK_REGIONS,
  DESK_SOURCES,
  KR_ONLY_GROUPS,
  type DeskRegion,
  type DeskSourceId,
} from '@/lib/desk-sources';

type RangePreset = 'all' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
const RANGE_PRESETS: { id: RangePreset; days: number | null }[] = [
  { id: 'all', days: null },
  { id: 'week', days: 7 },
  { id: 'month', days: 30 },
  { id: 'quarter', days: 90 },
  { id: 'year', days: 365 },
  { id: 'custom', days: null },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n\t、·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 수집 소스는 항상 전체 (단 region 변경 시 KR-only 그룹 자동 제외).
// 디자인에서 사용자 노출 제거 — selected 는 region 에 의존적으로 자동 관리.
function sourcesForRegion(region: DeskRegion): Set<DeskSourceId> {
  const out = new Set<DeskSourceId>();
  for (const s of DESK_SOURCES) {
    if (region !== 'KR' && KR_ONLY_GROUPS.includes(s.group)) continue;
    out.add(s.id);
  }
  return out;
}

function DeskMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-4 mt-2 border-b border-line pb-2 text-3xl font-bold tracking-[-0.02em] text-ink first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-3 mt-8 text-2xl font-bold tracking-[-0.018em] text-ink-2 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-5 text-xl font-semibold tracking-[-0.005em] text-ink-2">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="my-2.5 text-lg leading-[1.8] text-ink-2">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="my-2.5 list-disc space-y-1 pl-5 text-lg leading-[1.8] marker:text-mute-soft">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2.5 list-decimal space-y-1 pl-5 text-lg leading-[1.8] marker:text-mute-soft">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="text-ink-2">{children}</li>,
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
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-amore bg-amore-bg px-4 py-2 text-lg italic text-ink-2">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="border border-line bg-paper-soft px-1.5 py-0.5 font-mono text-md text-ink-2 [border-radius:3px]">
            {children}
          </code>
        ),
        hr: () => <hr className="my-6 border-line-soft" />,
        strong: ({ children }) => (
          <strong className="font-semibold text-ink">{children}</strong>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}

export function DeskResearch() {
  const tDesk = useTranslations('Desk');
  const tCommon = useTranslations('Common');
  const locale = useLocale();
  const requireAuth = useRequireAuth();
  const { latestJob, isWorking, cancelJob } = useDeskJobs();

  // ─── inputs ──────────────────────────────────────────────────────────────
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [preset, setPreset] = useState<RangePreset>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [region, setRegion] = useState<DeskRegion>('KR');
  // selected 는 region 에 의존적으로 자동 관리 — UI 미노출.
  const [selected, setSelected] = useState<Set<DeskSourceId>>(() =>
    sourcesForRegion('KR'),
  );

  function changeRegion(next: DeskRegion) {
    setRegion(next);
    setSelected(sourcesForRegion(next));
  }

  const [submitting, setSubmitting] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Receive workspace "send to" prefills — splits the artifact text the
  // same way the paste/keydown handlers do so a list of keywords (or a
  // comma/newline-separated blob) lands as ready-to-run keyword chips.
  useEffect(() => {
    try {
      const k = prefillKey('desk');
      const raw = sessionStorage.getItem(k);
      if (!raw) return;
      sessionStorage.removeItem(k);
      pushKeywords(splitKeywords(raw));
    } catch {}

  }, []);

  // ─── keyword tag input ────────────────────────────────────────────────────
  function pushKeywords(parts: string[]) {
    if (parts.length === 0) return;
    setKeywords((prev) => {
      const seen = new Set(prev);
      const out = [...prev];
      for (const p of parts) {
        if (!p || seen.has(p)) continue;
        if (out.length >= 10) break;
        out.push(p);
        seen.add(p);
      }
      return out;
    });
  }
  function removeKeyword(idx: number) {
    setKeywords(keywords.filter((_, i) => i !== idx));
  }
  function commitDraft(raw?: string): string[] {
    const source = raw ?? keywordDraft;
    const parts = splitKeywords(source);
    pushKeywords(parts);
    setKeywordDraft('');
    const seen = new Set(keywords);
    const merged = [...keywords];
    for (const p of parts) {
      if (!p || seen.has(p)) continue;
      if (merged.length >= 10) break;
      merged.push(p);
      seen.add(p);
    }
    return merged;
  }
  function onKeywordKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (keywordDraft.trim()) {
        e.preventDefault();
        commitDraft();
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && !keywordDraft && keywords.length) {
      setKeywords(keywords.slice(0, -1));
    }
  }
  function onKeywordPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (/[,\n\t、·]/.test(pasted)) {
      e.preventDefault();
      const merged = (keywordDraft + pasted).trim();
      const parts = splitKeywords(merged);
      pushKeywords(parts);
      setKeywordDraft('');
    }
  }

  // ─── date range ──────────────────────────────────────────────────────────
  function applyPreset(p: RangePreset) {
    setPreset(p);
    if (p === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (p !== 'custom') {
      const days = RANGE_PRESETS.find((x) => x.id === p)?.days ?? null;
      if (days != null) {
        setDateFrom(daysAgoIso(days));
        setDateTo(todayIso());
      }
    }
  }

  // ─── submit ──────────────────────────────────────────────────────────────
  function onClickRun() {
    requireAuth(() => void doSubmit());
  }
  async function doSubmit() {
    const finalKeywords = commitDraft();
    if (finalKeywords.length === 0) {
      setError(tDesk('errorNoKeyword'));
      return;
    }
    setSubmitting(true);
    setError(null);
    track('desk_generate_click', { feature: 'desk', kw_count: finalKeywords.length });
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keywords: finalKeywords,
          sources: Array.from(selected),
          locale: locale === 'ko' ? 'ko' : 'en',
          region,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          project_id: readActiveProjectId(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        setSubmitting(false);
        return;
      }
      track('desk_generate_success', { feature: 'desk', job_id: json.job_id });
      if (typeof json.job_id === 'string') {
        setPendingJobId(json.job_id);
      } else {
        setSubmitting(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!pendingJobId) return;
    if (latestJob?.id === pendingJobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to external/prop/ref change
      setPendingJobId(null);
      setSubmitting(false);
      return;
    }
    const t = setTimeout(() => {
      setPendingJobId(null);
      setSubmitting(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [pendingJobId, latestJob?.id]);

  // ─── current job + thinking panel ──────────────────────────────────────────
  const job: DeskJob | null = latestJob;
  const events = useMemo(() => job?.progress?.events ?? [], [job?.progress?.events]);
  const showStream = !!job && (isWorking || events.length > 0);
  const thoughtsScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thoughtsScroller.current) {
      thoughtsScroller.current.scrollTop = thoughtsScroller.current.scrollHeight;
    }
  }, [events.length]);

  // ─── download ──────────────────────────────────────────────────────────────
  function buildFilename(): string {
    return buildArtifactBaseName({
      prefix: 'desk',
      slug: job?.keywords[0],
      createdAt: job?.created_at ?? new Date(),
    });
  }
  async function downloadDocx(markdown: string) {
    setExporting(true);
    track('desk_export_docx_click', { feature: 'desk', format: 'docx' });
    try {
      const filename = buildFilename();
      const res = await fetch('/api/desk/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          markdown,
          filename,
          title: job?.keywords?.length
            ? `데스크 리서치 — ${job.keywords.join(', ')}`
            : '데스크 리서치',
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? res.statusText);
        return;
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, `${filename}.docx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export_failed');
    } finally {
      setExporting(false);
    }
  }

  const hasKeywords = keywords.length > 0 || keywordDraft.trim().length > 0;
  const canRun =
    !submitting && !pendingJobId && !isWorking && hasKeywords && selected.size > 0;
  const showResult = !!(job?.status === 'done' && job.output);
  const cardState: 'idle' | 'running' | 'done' | 'error' =
    job?.status === 'error'
      ? 'error'
      : isWorking
        ? 'running'
        : job?.status === 'done'
          ? 'done'
          : 'idle';
  const showRange = preset === 'custom' || (preset !== 'all' && (dateFrom || dateTo));

  // 결과 row 메타: 출처 수 / 처리 시간 (wall-clock)
  const sourcesCount = job?.articles?.length ?? 0;
  const wallSec = job
    ? Math.max(
        0,
        Math.round(
          (new Date(job.updated_at).getTime() - new Date(job.created_at).getTime()) /
            1000,
        ),
      )
    : 0;
  const wallLabel =
    wallSec >= 60
      ? `${Math.floor(wallSec / 60)}분 ${wallSec % 60}초`
      : `${wallSec}초`;

  return (
    <div className="mx-auto w-full max-w-[860px]">
      <div className="flex flex-col overflow-hidden rounded-md border border-line bg-paper-soft shadow-bento">
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-line-soft bg-amore-bg px-5 py-4">
          <Image
            src="/thumbnail/deskresearch.png"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-sm object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-medium text-ink-2">데스크 리서치</span>
              <StatePill phase={cardState} />
            </div>
            <div className="mt-0.5 text-sm text-mute line-clamp-1">
              키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로
            </div>
          </div>
          <span className="shrink-0 text-xs text-mute-soft">25 크레딧</span>
        </div>

        {/* Inputs */}
        <div className="space-y-5 px-5 py-5">
          <Field label={tDesk('regionLabel')}>
            <div className="flex flex-wrap gap-1.5">
              {DESK_REGIONS.map((r) => (
                <Button
                  key={r}
                  variant={region === r ? 'primary' : 'ghost'}
                  size="xs"
                  onClick={() => changeRegion(r)}
                >
                  {tDesk(`region.${r}`)}
                </Button>
              ))}
            </div>
          </Field>

          <Field label={tDesk('rangeLabel')}>
            <div className="flex flex-wrap gap-1.5">
              {RANGE_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  variant={preset === p.id ? 'primary' : 'ghost'}
                  size="xs"
                  onClick={() => applyPreset(p.id)}
                >
                  {tDesk(`range_${p.id}` as const)}
                </Button>
              ))}
            </div>
            {showRange && (
              <div className="mt-3 flex items-center gap-2 text-md text-mute">
                <Input
                  type="date"
                  size="sm"
                  fullWidth={false}
                  value={dateFrom}
                  max={dateTo || todayIso()}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPreset('custom');
                  }}
                  className="px-2 py-1 text-ink-2"
                />
                <span className="text-mute-soft">→</span>
                <Input
                  type="date"
                  size="sm"
                  fullWidth={false}
                  value={dateTo}
                  min={dateFrom || undefined}
                  max={todayIso()}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPreset('custom');
                  }}
                  className="px-2 py-1 text-ink-2"
                />
              </div>
            )}
          </Field>

          <Field label={tDesk('keywordLabel')}>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xs border border-line bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
              {keywords.map((k, idx) => (
                <span
                  key={`${k}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-pill border border-amore bg-amore-bg px-2.5 py-0.5 text-xs text-amore"
                >
                  {k}
                  <IconButton
                    variant="ghost-brand"
                    onClick={() => removeKeyword(idx)}
                    aria-label={`remove ${k}`}
                  >
                    ×
                  </IconButton>
                </span>
              ))}
              <ChipInput
                value={keywordDraft}
                onChange={(e) => setKeywordDraft(e.target.value)}
                onKeyDown={onKeywordKeyDown}
                onPaste={onKeywordPaste}
                onBlur={() => {
                  if (keywordDraft.trim()) commitDraft();
                }}
                placeholder={
                  keywords.length === 0
                    ? tDesk('keywordPlaceholder')
                    : tDesk('keywordAddMore')
                }
                className="min-w-[140px] flex-1"
              />
            </div>
            <span className="mt-1.5 block text-xs text-mute-soft">
              {tDesk('keywordHint')}
            </span>
          </Field>

          <Button
            variant="primary"
            size="md"
            onClick={onClickRun}
            disabled={!canRun}
            className="w-full"
          >
            {submitting || pendingJobId || isWorking
              ? tCommon('loading')
              : tDesk('search')}
          </Button>
        </div>

        {/* Streaming panel — running 또는 events 있을 때 */}
        {showStream && (
          <div className="border-t border-line-soft bg-paper px-5 py-4">
            {isWorking ? (
              <JobProgress
                value={
                  job?.progress?.crawl_total
                    ? Math.round(
                        ((job.progress.crawl_done ?? 0) /
                          job.progress.crawl_total) *
                          100,
                      )
                    : undefined
                }
                label={tDesk('thinkingActive')}
                hint={
                  job?.progress?.crawl_total
                    ? `${job.progress.crawl_done ?? 0}/${job.progress.crawl_total}`
                    : undefined
                }
                onCancel={
                  job
                    ? job.cancel_requested
                      ? undefined
                      : () => void cancelJob(job.id)
                    : undefined
                }
                cancelLabel={
                  job?.cancel_requested ? tDesk('stopRequested') : tDesk('stop')
                }
              />
            ) : (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.22em] text-mute-soft">
                  {tDesk('thinkingDone')}
                </span>
                <span className="text-xs text-mute-soft">{events.length} 이벤트</span>
              </div>
            )}
            <div
              ref={thoughtsScroller}
              className="mt-2 h-[240px] overflow-y-auto rounded-xs border border-line bg-paper-soft px-4 py-3 text-md leading-[1.7]"
            >
              {events.map((line, i) => (
                <div key={i} className="py-0.5 text-ink-2">
                  <span className="mr-2 text-amore">›</span>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 방금 만든 결과물 — 1개 row */}
        {showResult && job && (
          <div className="border-t border-line-soft px-5 py-4">
            <div className="mb-2 text-xs uppercase tracking-wider text-mute-soft">
              방금 만든 결과물
            </div>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setPreviewOpen(true)}
              className="w-full justify-start gap-3 border border-line bg-paper px-4 py-3 hover:border-ink"
            >
              <span className="text-lg">📄</span>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-md font-medium text-ink-2">
                  {job.keywords.join(', ')} · {tDesk('reportTitle')}
                </div>
                <div className="mt-0.5 text-xs text-mute-soft">
                  {sourcesCount} sources · {wallLabel}
                </div>
              </div>
              <span className="shrink-0 text-xs text-amore">프리뷰 →</span>
            </Button>
          </div>
        )}

        {/* error / cancelled banners */}
        {error && (
          <div className="border-t border-warning-line bg-warning-bg px-5 py-3 text-md text-ink-2">
            {tDesk('error')}: <span className="font-mono">{error}</span>
          </div>
        )}
        {job?.status === 'error' && job.error_message && (
          <div className="border-t border-warning-line bg-warning-bg px-5 py-3 text-md text-ink-2">
            {tDesk('error')}: <span className="font-mono">{job.error_message}</span>
          </div>
        )}
        {job?.status === 'cancelled' && (
          <div className="border-t border-line-soft px-5 py-4">
            <EmptyState tone="subtle" title={tDesk('cancelledNotice')} />
          </div>
        )}
      </div>

      <Modal
        open={previewOpen && showResult && job != null}
        onClose={() => setPreviewOpen(false)}
        size="xl"
        title={job ? `${job.keywords.join(', ')} · ${tDesk('reportTitle')}` : ''}
        description="데스크 리서치 결과"
        footer={
          job ? (
            <>
              <DownloadMenu
                tone="ghost"
                align="end"
                disabled={exporting}
                items={[
                  {
                    format: 'md',
                    kind: 'blob',
                    filename: `${buildFilename()}.md`,
                    build: () =>
                      new Blob([job.output ?? ''], {
                        type: 'text/markdown;charset=utf-8',
                      }),
                  },
                  {
                    format: 'docx',
                    kind: 'action',
                    onSelect: () => downloadDocx(job.output ?? ''),
                  },
                ]}
              />
              <ShareMenu
                align="end"
                disabled={!job.output}
                items={[
                  {
                    destination: 'google-docs',
                    title: buildFilename(),
                    getBlob: async () => {
                      const res = await fetch('/api/desk/export', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          markdown: job.output ?? '',
                          filename: buildFilename(),
                          title: job.keywords?.length
                            ? `데스크 리서치 — ${job.keywords.join(', ')}`
                            : '데스크 리서치',
                        }),
                      });
                      return {
                        blob: await res.blob(),
                        mimeType:
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      };
                    },
                  },
                ]}
              />
            </>
          ) : null
        }
      >
        {job && (
          <div className="space-y-6">
            {job.skipped && job.skipped.length > 0 && (
              <div className="rounded-sm border border-warning-line bg-warning-bg p-4 text-md text-ink-2">
                <div className="font-semibold">{tDesk('skippedTitle')}</div>
                <ul className="mt-1.5 space-y-0.5 font-mono text-sm text-mute">
                  {job.skipped.map((s) => (
                    <li key={s.source}>
                      · {s.source} — {s.missing}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {job.similar_keywords.length > 0 && (
              <section>
                <span className="block text-xs uppercase tracking-[.22em] text-amore">
                  {tDesk('similarKeywords')}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {job.similar_keywords.map((k) => (
                    <span
                      key={k}
                      className="rounded-sm border border-line bg-paper-soft px-2.5 py-1 text-sm text-mute"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {job.analytics && <DeskAnalyticsPanel analytics={job.analytics} />}

            <article className="rounded-sm border border-line bg-paper p-6 text-lg leading-[1.75] text-ink-2">
              <DeskMarkdown source={job.output ?? ''} />
            </article>

            {job.articles && job.articles.length > 0 && (
              <section>
                <h2 className="border-b border-line pb-3 text-xl font-semibold tracking-[-0.005em] text-ink-2">
                  {tDesk('collected')} ({job.articles.length})
                </h2>
                <ul className="mt-3 divide-y divide-line rounded-sm border border-line bg-paper">
                  {job.articles.map((a) => (
                    <li key={`${a.source}-${a.url}`} className="px-4 py-3">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-lg font-semibold text-ink-2 hover:text-amore"
                      >
                        {a.title}
                      </a>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-mute-soft">
                        <span className="uppercase tracking-[.18em]">
                          {a.source}
                        </span>
                        {a.origin && <span>{a.origin}</span>}
                        {a.publishedAt && <span>{a.publishedAt}</span>}
                        <span className="text-amore">#{a.keyword}</span>
                      </div>
                      {a.snippet && (
                        <p className="mt-1.5 text-md leading-[1.65] text-mute">
                          {a.snippet}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wider text-mute-soft">
        {label}
      </div>
      {children}
    </div>
  );
}

function StatePill({ phase }: { phase: 'idle' | 'running' | 'done' | 'error' }) {
  const map = {
    idle: { label: '대기', cls: 'bg-paper text-mute' },
    running: { label: '진행 중', cls: 'bg-amore-bg text-amore' },
    done: { label: '완료', cls: 'bg-mint text-ink' },
    error: { label: '오류', cls: 'bg-warning-bg text-warning' },
  };
  const v = map[phase];
  return (
    <span className={`inline-flex items-center rounded-pill px-2 py-0 text-xs ${v.cls}`}>
      {v.label}
    </span>
  );
}
