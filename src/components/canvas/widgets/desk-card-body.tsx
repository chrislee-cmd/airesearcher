'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslations, useLocale } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { track } from '@/components/mixpanel-provider';
import { useRequireAuth } from '@/components/auth-provider';

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
import {
  useDeskJobs,
  type DeskJob,
  type DeskClaim,
  type DeskResearchQuestion,
  type DeskRqAnswer,
} from '@/components/desk-job-provider';
import { DeskAnalyticsPanel } from '@/components/desk-analytics-panel';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { JobProgress } from '@/components/ui/job-progress';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { ChipInput } from '@/components/ui/chip-input';
import {
  WidgetOutputRow,
  WidgetOutputs,
} from '@/components/canvas/shell/widget-outputs';
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

// 수집 소스는 항상 전체. KR-only 그룹 (네이버/카카오) 은 selected regions 에
// KR 이 포함될 때만 union 으로 추가 — 그 외 region 만 선택하면 결과가 거의 없어
// API quota 낭비. 디자인에서 사용자 노출 제거 — selected 는 regions 에 의존적으로
// 자동 관리.
function sourcesForRegions(regions: Set<DeskRegion>): Set<DeskSourceId> {
  const includeKrOnly = regions.has('KR');
  const out = new Set<DeskSourceId>();
  for (const s of DESK_SOURCES) {
    if (!includeKrOnly && KR_ONLY_GROUPS.includes(s.group)) continue;
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
          <blockquote className="my-3 border-l-2 border-amore bg-white px-4 py-2 text-lg italic text-ink-2">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="border border-line bg-white px-1.5 py-0.5 font-mono text-md text-ink-2 [border-radius:3px]">
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

// 데스크 리서치 카드 본문 — canvas widget shell 의 ExpandedBody slot 에 마운트.
// 시각적 chrome (border / rounded / shadow) + 헤더 (썸네일 + 라벨 + state pill +
// cost) 는 widget-shell 이 그리고, 본문 (입력 + 스트리밍 + 결과 + 모달) 만 여기.
// hooks · handlers · 모든 helpers 는 PR #349/#352 디자인 그대로 가져옴.
export function DeskCardBody() {
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
  // 멀티 region 선택 — 최소 1개 보장 (모두 해제 X, API 가 region 을 필요로 함).
  const [regions, setRegions] = useState<Set<DeskRegion>>(
    () => new Set(['KR']),
  );
  // selected 는 regions union 에 의존적으로 자동 관리 — UI 미노출.
  const [selected, setSelected] = useState<Set<DeskSourceId>>(() =>
    sourcesForRegions(new Set(['KR'])),
  );

  function toggleRegion(r: DeskRegion) {
    setRegions((prev) => {
      const next = new Set(prev);
      if (next.has(r)) {
        if (next.size <= 1) return prev; // 최소 1개 보장
        next.delete(r);
      } else {
        next.add(r);
      }
      setSelected(sourcesForRegions(next));
      return next;
    });
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
          regions: Array.from(regions),
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
  // cardState 는 widget shell 외부에서 결정 (PR2 시점에는 widget meta.state
  // 가 'idle' 로 고정 — 후속 PR 에서 widget shell 로 live state 주입 검토).
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
    <>
      {/* 본문 — chrome 과 헤더는 widget-shell 책임. body 는 flex column
          으로 중간 영역 (flex-1, inputs + streaming + 에러 배너) / 최근
          산출물 (bottom) 로 나뉘어 — 산출물이 카드 바닥에 고정. */}
      <div className="flex h-full flex-col">
        {/* 중간 영역 — flex-1 로 산출물을 바닥으로 밀어내고, 내용이
            길어지면 자체적으로 스크롤. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Inputs */}
        <div className="space-y-5 px-5 py-5">
          <Field label={tDesk('regionLabel')}>
            <div className="flex flex-wrap gap-1.5">
              {DESK_REGIONS.map((r) => {
                const isSelected = regions.has(r);
                return (
                  <Button
                    key={r}
                    variant={isSelected ? 'primary' : 'ghost'}
                    size="xs"
                    onClick={() => toggleRegion(r)}
                    aria-pressed={isSelected}
                  >
                    {tDesk(`region.${r}`)}
                  </Button>
                );
              })}
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
            <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-[2px] border-ink bg-paper px-3 py-2 min-h-[44px] focus-within:border-amore">
              {keywords.map((k, idx) => (
                <span
                  key={`${k}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-pill border border-amore bg-white px-2.5 py-0.5 text-xs text-amore"
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
          <div className="border-t border-line-soft bg-paper px-5 py-5">
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
                label={(() => {
                  const phase = job?.progress?.phase;
                  if (phase) {
                    try {
                      return tDesk(`phaseLabel.${phase}` as never);
                    } catch {
                      return tDesk('thinkingActive');
                    }
                  }
                  return tDesk('thinkingActive');
                })()}
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
              className="mt-2 h-[240px] overflow-y-auto rounded-xs border border-line bg-white px-4 py-3 text-md leading-[1.7]"
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
          <div className="border-t border-line-soft px-5 py-5">
            <EmptyState tone="subtle" title={tDesk('cancelledNotice')} />
          </div>
        )}
        </div>

        {/* 최근 산출물 — 카드 바닥에 고정 (flex column 의 마지막 자식).
            primitive 가 빈 상태 placeholder 도 책임 — done 잡 없으면
            "아직 없습니다" 안내. quotes 와 시각 통일. Download / Share 는
            row 가 아닌 모달 footer 에 — 기존 동작 유지. */}
        <WidgetOutputs
          label="최근 산출물"
          items={showResult && job ? [job] : []}
          renderItem={(j) => (
            <WidgetOutputRow
              key={j.id}
              title={`${j.keywords.join(', ')} · ${tDesk('reportTitle')}`}
              meta={
                <>
                  <span>{sourcesCount} sources</span>
                  <span>{wallLabel}</span>
                </>
              }
              actions={
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setPreviewOpen(true)}
                  className="uppercase tracking-[0.18em]"
                >
                  미리보기
                </Button>
              }
            />
          )}
        />
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
                      className="rounded-sm border border-line bg-white px-2.5 py-1 text-sm text-mute"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {job.analytics && <DeskAnalyticsPanel analytics={job.analytics} />}

            {job.research_questions && job.research_questions.length > 0 && (
              <RqFindingsSection
                rqs={job.research_questions}
                answers={job.rq_answers}
                tDesk={tDesk}
              />
            )}

            <QuantSnapshotsSection claims={job.claims} tDesk={tDesk} />

            {job.claims && job.claims.length > 0 && (
              <TierDistributionSection claims={job.claims} tDesk={tDesk} />
            )}

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
    </>
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

type TDesk = ReturnType<typeof useTranslations<'Desk'>>;

const CONFIDENCE_ICON: Record<DeskRqAnswer['confidence'], string> = {
  high: '🟢',
  medium: '🟡',
  low: '🔴',
};

function RqFindingsSection({
  rqs,
  answers,
  tDesk,
}: {
  rqs: DeskResearchQuestion[];
  answers: DeskRqAnswer[] | null;
  tDesk: TDesk;
}) {
  const byId = new Map(answers?.map((a) => [a.rq_id, a]) ?? []);
  return (
    <section>
      <h2 className="border-b border-line pb-3 text-xl font-semibold tracking-[-0.005em] text-ink-2">
        {tDesk('rqAnswersTitle')} ({rqs.length})
      </h2>
      <ul className="mt-3 space-y-3">
        {rqs.map((rq) => {
          const a = byId.get(rq.id);
          return (
            <li
              key={rq.id}
              className="rounded-sm border border-line bg-paper px-4 py-3 text-md leading-[1.6] text-ink-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[.18em] text-mute">
                <span>{rq.id}</span>
                <span className="text-amore">{rq.category}</span>
                <span>
                  {tDesk('importance')} {rq.importance}/5
                </span>
                {a && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-pill border border-line bg-white px-2 py-0.5 normal-case tracking-normal text-mute">
                    <span aria-hidden>{CONFIDENCE_ICON[a.confidence]}</span>
                    <span>
                      {tDesk('confidenceLabel')} · {a.confidence}
                    </span>
                  </span>
                )}
              </div>
              <p className="mt-1.5 font-semibold text-ink-2">{rq.question}</p>
              {a && (
                <>
                  <div className="mt-2 whitespace-pre-line text-md leading-[1.7] text-ink-2">
                    {a.answer_md}
                  </div>
                  {a.missing_data.length > 0 && (
                    <div className="mt-3 rounded-xs border border-line-soft bg-white px-3 py-2 text-sm text-mute">
                      <div className="text-xs uppercase tracking-[.18em] text-mute-soft">
                        {tDesk('missingDataLabel')}
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {a.missing_data.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuantSnapshotsSection({
  claims,
  tDesk,
}: {
  claims: DeskClaim[] | null;
  tDesk: TDesk;
}) {
  const quant = (claims ?? []).filter(
    (c): c is Extract<DeskClaim, { kind: 'quant' }> => c.kind === 'quant',
  );
  return (
    <section>
      <h2 className="border-b border-line pb-3 text-xl font-semibold tracking-[-0.005em] text-ink-2">
        {tDesk('quantSnapshotsTitle')} ({quant.length})
      </h2>
      {quant.length === 0 ? (
        <p className="mt-3 rounded-sm border border-line-soft bg-white px-4 py-3 text-md text-mute">
          {tDesk('quantSnapshotsEmpty')}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-sm border border-line">
          <table className="w-full border-collapse text-md">
            <thead className="bg-white text-xs uppercase tracking-[.16em] text-mute-soft">
              <tr>
                <th className="border-b border-line px-3 py-2 text-left font-medium">
                  {tDesk('cols.subject')}
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium">
                  {tDesk('cols.value')}
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium">
                  {tDesk('cols.source')}
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium">
                  {tDesk('cols.tier')}
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium">
                  {tDesk('cols.confidence')}
                </th>
              </tr>
            </thead>
            <tbody>
              {quant.slice(0, 30).map((c, i) => (
                <tr key={`${c.article_url}-${i}`} className="text-ink-2">
                  <td className="border-b border-line-soft px-3 py-2 align-top">
                    {c.subject}
                  </td>
                  <td className="border-b border-line-soft px-3 py-2 align-top font-semibold text-amore">
                    {c.value}
                    {c.unit ? ` ${c.unit}` : ''}
                  </td>
                  <td className="border-b border-line-soft px-3 py-2 align-top">
                    <a
                      href={c.article_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amore underline decoration-amore/40 underline-offset-2 hover:decoration-amore"
                    >
                      {tDesk('viewSource')}
                    </a>
                  </td>
                  <td className="border-b border-line-soft px-3 py-2 align-top text-mute">
                    {c.tier}
                  </td>
                  <td className="border-b border-line-soft px-3 py-2 align-top text-mute">
                    {c.confidence}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TierDistributionSection({
  claims,
  tDesk,
}: {
  claims: DeskClaim[];
  tDesk: TDesk;
}) {
  const counts = claims.reduce<Record<string, number>>((acc, c) => {
    acc[c.tier] = (acc[c.tier] ?? 0) + 1;
    return acc;
  }, {});
  const rows: { key: string; label: string; count: number }[] = [
    { key: 'T1', label: 'T1', count: counts.T1 ?? 0 },
    { key: 'T2', label: 'T2', count: counts.T2 ?? 0 },
    { key: 'T3', label: 'T3', count: counts.T3 ?? 0 },
    { key: 'unknown', label: tDesk('tierUnknownLabel'), count: counts.unknown ?? 0 },
  ];
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return null;
  return (
    <section>
      <h2 className="border-b border-line pb-3 text-xl font-semibold tracking-[-0.005em] text-ink-2">
        {tDesk('tierDistributionTitle')}
      </h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => {
          const pct = Math.round((r.count / total) * 100);
          return (
            <li key={r.key} className="flex items-center gap-3 text-md text-ink-2">
              <span className="w-16 shrink-0 text-xs uppercase tracking-[.18em] text-mute">
                {r.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-pill border border-line bg-white">
                <div
                  className="h-full bg-amore"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-sm text-mute">
                {r.count} · {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// StatePill 은 widget-shell 측에서 그림 — body 안에서는 제거 (헤더 stripped).
