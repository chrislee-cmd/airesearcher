'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { track } from './mixpanel-provider';
import { useRequireAuth } from './auth-provider';
import { DESK_SOURCES, type DeskArticle, type DeskSourceId } from '@/lib/desk-sources';

type DeskResponse = {
  output: string;
  generation_id: string;
  similar_keywords: string[];
  articles: DeskArticle[];
};

export function DeskResearch() {
  const t = useTranslations('Features');
  const tDesk = useTranslations('Desk');
  const tCommon = useTranslations('Common');
  const locale = useLocale();
  const requireAuth = useRequireAuth();

  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<DeskSourceId>>(
    new Set<DeskSourceId>(['google_news']),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DeskResponse | null>(null);

  function toggleSource(id: DeskSourceId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onClickRun() {
    requireAuth(() => void doRun());
  }

  async function doRun() {
    setRunning(true);
    setError(null);
    setData(null);
    track('generate_clicked', { feature: 'desk' });
    try {
      const res = await fetch('/api/desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keyword: keyword.trim(),
          sources: Array.from(selected),
          locale: locale === 'en' ? 'en' : 'ko',
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? res.statusText);
        return;
      }
      setData(json as DeskResponse);
      track('generate_success', { feature: 'desk' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown_error');
    } finally {
      setRunning(false);
    }
  }

  const canRun = !running && keyword.trim().length > 0 && selected.size > 0;

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

      {/* Keyword input */}
      <section className="mt-8">
        <label
          className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore"
          htmlFor="desk-keyword"
        >
          {tDesk('keywordLabel')}
        </label>
        <input
          id="desk-keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={tDesk('keywordPlaceholder')}
          className="mt-2 w-full border border-line bg-paper px-4 py-3 text-[13.5px] text-ink-2 placeholder:text-mute-soft focus:border-amore focus:outline-none [border-radius:4px]"
        />
      </section>

      {/* Source picker */}
      <section className="mt-8">
        <span className="block text-[11px] font-semibold uppercase tracking-[.22em] text-amore">
          {tDesk('sourcesLabel')}
        </span>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DESK_SOURCES.map((s) => {
            const checked = selected.has(s.id);
            return (
              <label
                key={s.id}
                className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors [border-radius:4px] ${
                  checked
                    ? 'border-amore bg-amore-bg'
                    : 'border-line bg-paper hover:bg-paper-soft'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSource(s.id)}
                  className="mt-[2px] accent-amore"
                />
                <span>
                  <span className="block text-[13px] font-semibold text-ink-2">
                    {locale === 'en' ? s.labelEn : s.label}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-mute">{s.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Run */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="text-[11px] tabular-nums text-mute-soft">
          {selected.size} {tDesk('sourcesUnit')}
        </span>
        <button
          onClick={onClickRun}
          disabled={!canRun}
          className="border border-ink bg-ink px-5 py-2 text-[12px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40 [border-radius:4px]"
        >
          {running ? tCommon('loading') : tDesk('search')}
        </button>
      </div>

      {error && (
        <div className="mt-6 border border-warning-line bg-warning-bg p-4 text-[12.5px] text-ink-2 [border-radius:4px]">
          {tDesk('error')}: <span className="font-mono">{error}</span>
        </div>
      )}

      {data && (
        <>
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
            <h2 className="border-b border-line pb-3 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
              {tDesk('reportTitle')}
            </h2>
            <pre className="mt-4 whitespace-pre-wrap border border-line bg-paper p-5 text-[13px] leading-[1.75] text-ink-2 [border-radius:4px]">
              {data.output}
            </pre>
          </section>

          {data.articles.length > 0 && (
            <section className="mt-10">
              <h2 className="border-b border-line pb-3 text-[15px] font-semibold tracking-[-0.005em] text-ink-2">
                {tDesk('collected')} ({data.articles.length})
              </h2>
              <ul className="mt-3 divide-y divide-line border border-line bg-paper [border-radius:4px]">
                {data.articles.map((a) => (
                  <li key={a.url} className="px-4 py-3">
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
