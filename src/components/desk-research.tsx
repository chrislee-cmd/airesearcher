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
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { useDeskJobs, type DeskJob } from './desk-job-provider';
import { DeskAnalyticsPanel } from './desk-analytics-panel';
import {
  DESK_REGIONS,
  DESK_SOURCES,
  DESK_SOURCE_GROUPS,
  KR_ONLY_GROUPS,
  type DeskRegion,
  type DeskSourceGroup,
  type DeskSourceId,
} from '@/lib/desk-sources';

const GROUP_ORDER: DeskSourceGroup[] = ['naver', 'kakao', 'youtube', 'global'];

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

function DeskMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mb-4 mt-2 border-b border-line pb-2 text-[22px] font-bold tracking-[-0.02em] text-ink first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-3 mt-8 text-[17px] font-bold tracking-[-0.018em] text-ink-2 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-5 text-[14px] font-semibold tracking-[-0.005em] text-ink-2">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="my-2.5 text-[13.5px] leading-[1.8] text-ink-2">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="my-2.5 list-disc space-y-1 pl-5 text-[13.5px] leading-[1.8] marker:text-mute-soft">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2.5 list-decimal space-y-1 pl-5 text-[13.5px] leading-[1.8] marker:text-mute-soft">
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
          <blockquote className="my-3 border-l-2 border-amore bg-amore-bg px-4 py-2 text-[13px] italic text-ink-2">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="border border-line bg-paper-soft px-1.5 py-0.5 font-mono text-[12px] text-ink-2 [border-radius:3px]">
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
  const t = useTranslations('Features');
  const tDesk = useTranslations('Desk');
  const tCommon = useTranslations('Common');
  const locale = useLocale();
  const requireAuth = useRequireAuth();
  const { latestJob, isWorking, cancelJob } = useDeskJobs();
  const isEn = locale === 'en';

  // ─── inputs ────────────────────────────────────────────────────────────────
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [preset, setPreset] = useState<RangePreset>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selected, setSelected] = useState<Set<DeskSourceId>>(
    new Set<DeskSourceId>(['naver_news', 'naver_blog', 'google_news']),
  );
  const [region, setRegion] = useState<DeskRegion>('KR');

  // When the user picks a non-KR region, auto-drop Naver/Kakao selections —
  // those APIs only return Korean-language content and would waste the budget.
  function changeRegion(next: DeskRegion) {
    setRegion(next);
    if (next !== 'KR') {
      setSelected((prev) => {
        const out = new Set<DeskSourceId>();
        for (const id of prev) {
          const meta = DESK_SOURCES.find((s) => s.id === id);
          if (meta && KR_ONLY_GROUPS.includes(meta.group)) continue;
          out.add(id);
        }
        // Make sure at least Google News stays on so the run isn't empty.
        if (out.size === 0) out.add('google_news');
        return out;
      });
    }
  }
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<DeskSourceGroup, typeof DESK_SOURCES>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const s of DESK_SOURCES) map.get(s.group)!.push(s);
    return map;
  }, []);

  // ─── keyword tag input ─────────────────────────────────────────────────────
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

  // ─── date range ────────────────────────────────────────────────────────────
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

  // ─── source toggle ─────────────────────────────────────────────────────────
  function toggle(id: DeskSourceId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleGroup(group: DeskSourceGroup) {
    const ids = DESK_SOURCES.filter((s) => s.group === group).map((s) => s.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  // ─── submit ────────────────────────────────────────────────────────────────
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
    track('generate_clicked', { feature: 'desk', kw_count: finalKeywords.length });
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keywords: finalKeywords,
          sources: Array.from(selected),
          locale: locale === 'en' ? 'en' : 'ko',
          region,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        return;
      }
      // Provider's realtime subscription will pick up the new row.
      track('generate_success', { feature: 'desk', job_id: json.job_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── current job + thinking panel ──────────────────────────────────────────
  const job: DeskJob | null = latestJob;
  const events = job?.progress?.events ?? [];
  const showPanel = !!job && (isWorking || events.length > 0);
  const thoughtsScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thoughtsScroller.current) {
      thoughtsScroller.current.scrollTop = thoughtsScroller.current.scrollHeight;
    }
  }, [events.length]);

  // ─── download ──────────────────────────────────────────────────────────────
  function buildFilename(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = job?.keywords[0]?.replace(/\s+/g, '-').slice(0, 60) || 'desk-research';
    return `desk-${slug}-${stamp}`;
  }
  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadMarkdown(markdown: string) {
    track('export_clicked', { feature: 'desk', format: 'md' });
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(blob, `${buildFilename()}.md`);
  }
  async function downloadDocx(markdown: string) {
    setExporting(true);
    track('export_clicked', { feature: 'desk', format: 'docx' });
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
      triggerDownload(blob, `${filename}.docx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export_failed');
    } finally {
      setExporting(false);
    }
  }

  const hasKeywords = keywords.length > 0 || keywordDraft.trim().length > 0;
  const canRun = !submitting && !isWorking && hasKeywords && selected.size > 0;
  const showResult = job?.status === 'done' && job.output;

  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">
          {t('desk.title')}
        </h1>
        <span className="shrink-0 text-[11.5px] tabular-nums text-mute-soft">
          {t('desk.cost')}
        </span>
      </div>
      <p className="mt-3 max-w-[820px] text-[12.5px] leading-[1.75] text-mute">
        {t('desk.description')}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <section>
            <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
              {tDesk('keywordLabel')}
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border border-line bg-paper px-3 py-2 focus-within:border-amore [border-radius:4px]">
              {keywords.map((k, idx) => (
                <span
                  key={`${k}-${idx}`}
                  className="inline-flex items-center gap-1 border border-amore bg-amore-bg px-2 py-0.5 text-[12px] text-ink-2 [border-radius:4px]"
                >
                  {k}
                  <button
                    type="button"
                    onClick={() => removeKeyword(idx)}
                    aria-label={`remove ${k}`}
                    className="text-mute hover:text-amore"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
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
                className="min-w-[140px] flex-1 bg-transparent py-0.5 text-[13px] text-ink-2 placeholder:text-mute-soft focus:outline-none"
              />
            </div>
            <span className="mt-1.5 block text-[10.5px] text-mute-soft">
              {tDesk('keywordHint')}
            </span>
          </section>

          <section>
            <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
              {tDesk('rangeLabel')}
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`px-2.5 py-1 text-[11.5px] [border-radius:4px] ${
                    preset === p.id
                      ? 'border border-amore bg-amore-bg text-ink-2'
                      : 'border border-line bg-paper text-mute hover:border-amore hover:text-amore'
                  }`}
                >
                  {tDesk(`range_${p.id}` as const)}
                </button>
              ))}
            </div>
            {(preset === 'custom' || (preset !== 'all' && (dateFrom || dateTo))) && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-mute">
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || todayIso()}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPreset('custom');
                  }}
                  className="border border-line bg-paper px-2 py-1 text-[12px] text-ink-2 [border-radius:4px]"
                />
                <span className="text-mute-soft">→</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  max={todayIso()}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPreset('custom');
                  }}
                  className="border border-line bg-paper px-2 py-1 text-[12px] text-ink-2 [border-radius:4px]"
                />
              </div>
            )}
          </section>
        </div>

        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
            {tDesk('regionLabel')}
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DESK_REGIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => changeRegion(r)}
                className={
                  'border px-2.5 py-1 text-[11.5px] [border-radius:4px] ' +
                  (region === r
                    ? 'border-ink bg-ink text-paper'
                    : 'border-line bg-paper text-ink-2 hover:text-amore')
                }
              >
                {tDesk(`region.${r}`)}
              </button>
            ))}
          </div>
          {region !== 'KR' && (
            <p className="mt-1.5 text-[11px] text-mute-soft">
              {tDesk('regionKrOnlyHidden')}
            </p>
          )}
        </div>

        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
            {tDesk('sourcesLabel')}
          </span>
          <div className="mt-2 space-y-3">
            {GROUP_ORDER.filter(
              (g) => region === 'KR' || !KR_ONLY_GROUPS.includes(g),
            ).map((g) => {
              const meta = DESK_SOURCE_GROUPS[g];
              const items = grouped.get(g) ?? [];
              const allOn = items.every((s) => selected.has(s.id));
              return (
                <div key={g} className="border border-line bg-paper [border-radius:4px]">
                  <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                    <span className="text-[12.5px] font-semibold text-ink-2">
                      {isEn ? meta.labelEn : meta.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g)}
                      className="text-[10px] uppercase tracking-[.18em] text-mute-soft hover:text-amore"
                    >
                      {allOn ? tDesk('groupNone') : tDesk('groupAll')}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2">
                    {items.map((s) => {
                      const checked = selected.has(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-2 py-0.5 text-[12.5px] text-ink-2 hover:text-amore"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(s.id)}
                            className="accent-amore"
                          />
                          <span>{isEn ? s.labelEn : s.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {keywords.length} {tDesk('keywordUnit')} · {selected.size} {tDesk('sourcesUnit')}
        </span>
        <button
          onClick={onClickRun}
          disabled={!canRun}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {submitting || isWorking ? tCommon('loading') : tDesk('search')}
        </button>
      </div>

      {showPanel && (
        <section className="mt-6 border border-line bg-paper-soft [border-radius:4px]">
          <header className="flex items-center justify-between border-b border-line-soft px-4 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 [border-radius:9999px] ${
                  isWorking ? 'animate-pulse bg-amore' : 'bg-mute-soft'
                }`}
              />
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {tDesk(isWorking ? 'thinkingActive' : 'thinkingDone')}
                {job?.progress?.crawl_total
                  ? ` · ${job.progress.crawl_done ?? 0}/${job.progress.crawl_total}`
                  : ''}
              </span>
            </div>
            {isWorking && job && (
              <button
                type="button"
                onClick={() => void cancelJob(job.id)}
                disabled={job.cancel_requested}
                className="border border-line bg-paper px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[.18em] text-mute hover:border-warning hover:text-warning disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
              >
                {job.cancel_requested ? tDesk('stopRequested') : tDesk('stop')}
              </button>
            )}
          </header>
          <div
            ref={thoughtsScroller}
            className="max-h-[280px] overflow-y-auto px-4 py-3 text-[12.5px] leading-[1.7]"
          >
            {events.map((line, i) => (
              <div key={i} className="py-0.5 text-ink-2">
                <span className="mr-2 text-amore">›</span>
                {line}
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="mt-6 border border-warning-line bg-warning-bg p-4 text-[12.5px] text-ink-2 [border-radius:4px]">
          {tDesk('error')}: <span className="font-mono">{error}</span>
        </div>
      )}

      {job?.status === 'error' && job.error_message && (
        <div className="mt-6 border border-warning-line bg-warning-bg p-4 text-[12.5px] text-ink-2 [border-radius:4px]">
          {tDesk('error')}: <span className="font-mono">{job.error_message}</span>
        </div>
      )}

      {job?.status === 'cancelled' && (
        <div className="mt-6 border border-line bg-paper-soft p-4 text-[12.5px] text-mute [border-radius:4px]">
          {tDesk('cancelledNotice')}
        </div>
      )}

      {showResult && (
        <>
          {job.skipped && job.skipped.length > 0 && (
            <div className="mt-6 border border-warning-line bg-warning-bg p-4 text-[12px] text-ink-2 [border-radius:4px]">
              <div className="font-semibold">{tDesk('skippedTitle')}</div>
              <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-mute">
                {job.skipped.map((s) => (
                  <li key={s.source}>
                    · {s.source} — {s.missing}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job.similar_keywords.length > 0 && (
            <section className="mt-10">
              <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
                {tDesk('similarKeywords')}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {job.similar_keywords.map((k) => (
                  <span
                    key={k}
                    className="border border-line bg-paper-soft px-2.5 py-1 text-[11.5px] text-mute [border-radius:4px]"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </section>
          )}

          {job.analytics && <DeskAnalyticsPanel analytics={job.analytics} />}

          <section className="mt-10">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                {tDesk('reportTitle')}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadMarkdown(job.output ?? '')}
                  className="border border-line bg-paper px-3 py-1.5 text-[11.5px] font-semibold text-ink-2 hover:border-amore hover:text-amore [border-radius:4px]"
                >
                  {tDesk('downloadMd')}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadDocx(job.output ?? '')}
                  disabled={exporting}
                  className="border border-line bg-paper px-3 py-1.5 text-[11.5px] font-semibold text-ink-2 hover:border-amore hover:text-amore disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
                >
                  {exporting ? tCommon('loading') : tDesk('downloadDocx')}
                </button>
              </div>
            </div>
            <article className="mt-4 border border-line bg-paper p-6 text-[13.5px] leading-[1.75] text-ink-2 [border-radius:4px]">
              <DeskMarkdown source={job.output ?? ''} />
            </article>
          </section>

          {job.articles && job.articles.length > 0 && (
            <section className="mt-10">
              <h2 className="border-b border-line pb-3 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                {tDesk('collected')} ({job.articles.length})
              </h2>
              <ul className="mt-3 divide-y divide-line border border-line bg-paper [border-radius:4px]">
                {job.articles.map((a) => (
                  <li key={`${a.source}-${a.url}`} className="px-4 py-3">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] font-semibold text-ink-2 hover:text-amore"
                    >
                      {a.title}
                    </a>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-mute-soft">
                      <span className="uppercase tracking-[.18em]">{a.source}</span>
                      {a.origin && <span>{a.origin}</span>}
                      {a.publishedAt && <span>{a.publishedAt}</span>}
                      <span className="text-amore">#{a.keyword}</span>
                    </div>
                    {a.snippet && (
                      <p className="mt-1.5 text-[12px] leading-[1.65] text-mute">
                        {a.snippet}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
