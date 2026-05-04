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
import {
  DESK_SOURCES,
  DESK_SOURCE_GROUPS,
  type DeskArticle,
  type DeskSourceGroup,
  type DeskSourceId,
} from '@/lib/desk-sources';

type Skipped = { source: DeskSourceId; missing: string };
type FinalPayload = {
  output: string;
  generation_id: string;
  similar_keywords: string[];
  articles: DeskArticle[];
  skipped?: Skipped[];
};

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

// Split a free-form input on common delimiters so paste-and-Enter works the
// same as type-with-comma. Korean comma `、` and 중점 `·` get included since
// users mix them in pasted lists.
function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n\t、·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Render the LLM-produced report markdown using the design-system tokens.
// We strip out raw URLs that the model occasionally drops outside of a
// markdown link by matching the canonical `[label](url)` form via remark — bare
// URLs are turned into auto-links by remark-gfm (so they still resolve), but
// we cap their visible width with break-all + truncate. Headings/lists/quotes
// follow the editorial style (1px lines, no shadows, single amore accent).
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
  const isEn = locale === 'en';

  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [preset, setPreset] = useState<RangePreset>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selected, setSelected] = useState<Set<DeskSourceId>>(
    new Set<DeskSourceId>(['naver_news', 'naver_blog', 'google_news']),
  );
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FinalPayload | null>(null);
  const [thoughts, setThoughts] = useState<string[]>([]);
  const thoughtsScroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thoughtsScroller.current) {
      thoughtsScroller.current.scrollTop = thoughtsScroller.current.scrollHeight;
    }
  }, [thoughts.length]);

  const grouped = useMemo(() => {
    const map = new Map<DeskSourceGroup, typeof DESK_SOURCES>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const s of DESK_SOURCES) map.get(s.group)!.push(s);
    return map;
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
    // Build the next-state array synchronously for the caller (setState is
    // async). De-dupe against current keywords plus the parts we just added.
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

  // ─── date range presets ───────────────────────────────────────────────────
  function applyPreset(p: RangePreset) {
    setPreset(p);
    if (p === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (p === 'custom') {
      // keep existing
    } else {
      const days = RANGE_PRESETS.find((x) => x.id === p)?.days ?? null;
      if (days != null) {
        setDateFrom(daysAgoIso(days));
        setDateTo(todayIso());
      }
    }
  }

  // ─── source toggle ────────────────────────────────────────────────────────
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

  // ─── run + stream consumption ─────────────────────────────────────────────
  function onClickRun() {
    requireAuth(() => void doRun());
  }

  async function doRun() {
    const finalKeywords = commitDraft();
    if (finalKeywords.length === 0) {
      setError(tDesk('errorNoKeyword'));
      return;
    }
    setRunning(true);
    setError(null);
    setData(null);
    setThoughts([]);
    track('generate_clicked', { feature: 'desk', kw_count: finalKeywords.length });

    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keywords: finalKeywords,
          sources: Array.from(selected),
          locale: locale === 'en' ? 'en' : 'ko',
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        }),
      });

      // Non-streaming JSON error path (auth/validation/credit failures).
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? res.statusText);
        return;
      }
      const ctype = res.headers.get('content-type') ?? '';
      if (!ctype.includes('ndjson')) {
        // Server returned a non-stream response — fall back to JSON.
        const j = await res.json().catch(() => ({}));
        if (j?.kind === 'final') setData(j.data as FinalPayload);
        else if (j?.error) setError(j.error);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as
              | { kind: 'thought'; text: string }
              | { kind: 'final'; data: FinalPayload }
              | { kind: 'error'; error: string };
            if (evt.kind === 'thought') {
              setThoughts((prev) => [...prev, evt.text]);
            } else if (evt.kind === 'final') {
              setData(evt.data);
              track('generate_success', { feature: 'desk' });
            } else if (evt.kind === 'error') {
              setError(evt.error);
            }
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setRunning(false);
    }
  }

  // ─── download ─────────────────────────────────────────────────────────────
  function buildFilename(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = keywords[0]?.replace(/\s+/g, '-').slice(0, 60) || 'desk-research';
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
          title: keywords.length
            ? `데스크 리서치 — ${keywords.join(', ')}`
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
  const canRun = !running && hasKeywords && selected.size > 0;
  const showPanel = running || thoughts.length > 0;

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
      {/* Header */}
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

      {/* Two-column control panel */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Left: keywords + date range ─────────────────────────────────── */}
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

        {/* ── Right: source groups (compact) ──────────────────────────────── */}
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
            {tDesk('sourcesLabel')}
          </span>
          <div className="mt-2 space-y-3">
            {GROUP_ORDER.map((g) => {
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

      {/* Run row */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {keywords.length} {tDesk('keywordUnit')} · {selected.size} {tDesk('sourcesUnit')}
        </span>
        <button
          onClick={onClickRun}
          disabled={!canRun}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : tDesk('search')}
        </button>
      </div>

      {/* Thinking panel — conversational progress */}
      {showPanel && (
        <section className="mt-6 border border-line bg-paper-soft [border-radius:4px]">
          <header className="flex items-center justify-between border-b border-line-soft px-4 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 [border-radius:9999px] ${
                  running ? 'animate-pulse bg-amore' : 'bg-mute-soft'
                }`}
              />
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {tDesk(running ? 'thinkingActive' : 'thinkingDone')}
              </span>
            </div>
            {!running && thoughts.length > 0 && (
              <button
                onClick={() => setThoughts([])}
                className="text-[10px] uppercase tracking-[0.18em] text-mute-soft hover:text-ink-2"
              >
                clear
              </button>
            )}
          </header>
          <div
            ref={thoughtsScroller}
            className="max-h-[280px] overflow-y-auto px-4 py-3 text-[12.5px] leading-[1.7]"
          >
            {thoughts.map((line, i) => (
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

      {data && (
        <>
          {data.skipped && data.skipped.length > 0 && (
            <div className="mt-6 border border-warning-line bg-warning-bg p-4 text-[12px] text-ink-2 [border-radius:4px]">
              <div className="font-semibold">{tDesk('skippedTitle')}</div>
              <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] text-mute">
                {data.skipped.map((s) => (
                  <li key={s.source}>
                    · {s.source} — {s.missing}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.similar_keywords.length > 0 && (
            <section className="mt-10">
              <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
                {tDesk('similarKeywords')}
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.similar_keywords.map((k) => (
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

          <section className="mt-10">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                {tDesk('reportTitle')}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadMarkdown(data.output)}
                  className="border border-line bg-paper px-3 py-1.5 text-[11.5px] font-semibold text-ink-2 hover:border-amore hover:text-amore [border-radius:4px]"
                >
                  {tDesk('downloadMd')}
                </button>
                <button
                  type="button"
                  onClick={() => void downloadDocx(data.output)}
                  disabled={exporting}
                  className="border border-line bg-paper px-3 py-1.5 text-[11.5px] font-semibold text-ink-2 hover:border-amore hover:text-amore disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
                >
                  {exporting ? tCommon('loading') : tDesk('downloadDocx')}
                </button>
              </div>
            </div>
            <article className="mt-4 border border-line bg-paper p-6 text-[13.5px] leading-[1.75] text-ink-2 [border-radius:4px]">
              <DeskMarkdown source={data.output} />
            </article>
          </section>

          {data.articles.length > 0 && (
            <section className="mt-10">
              <h2 className="border-b border-line pb-3 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                {tDesk('collected')} ({data.articles.length})
              </h2>
              <ul className="mt-3 divide-y divide-line border border-line bg-paper [border-radius:4px]">
                {data.articles.map((a) => (
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
