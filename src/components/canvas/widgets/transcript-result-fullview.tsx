'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptResultFullview — 완료 전사 1건의 결과 fullview (Canvas 1c,
   Widget Fullviews.dc.html / BUILD-SPEC-TRANSCRIPT §6).

   좌 · 전사록: 검색 pill + 화자별/타임스탬프 토글 툴바 + 화자 turn 스트림
   (아바타 진행자 sky/참가자 pink + 이름 + 타임스탬프 + 발화). turn 은
   /api/transcripts/jobs/[id]/turns 에서 fetch(라벨링된 markdown 파싱).
   우 · 사이드바(340 고정): Export 3버튼(.docx/.txt/.srt) + AI 요약/Key themes
   자리(T4 후속 — placeholder). 전사/잡 파이프 회귀 0(읽기 전용 렌더).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { getLanguage } from '@/lib/transcripts/languages';
import type { TranscriptJob } from '@/components/transcript-job-provider';
import type { TranscriptTurn } from '@/lib/transcripts/turns';

const LAV_TONE = 'var(--widget-header-bg-lav)';

type TurnView = 'speaker' | 'timestamp';

type TurnsMeta = {
  name: string;
  durationSeconds: number | null;
  speakers: number | null;
  language: string | null;
  provider: string | null;
  createdAt: string;
};

type TurnsResponse = { turns: TranscriptTurn[]; meta: TurnsMeta };

function formatMinutes(seconds: number | null): number | null {
  if (!seconds || seconds < 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

function languageBadge(code: string | null): string | null {
  if (!code) return null;
  const entry = getLanguage(code);
  const flag = entry?.flag ?? '🌐';
  return `${flag} ${code.toUpperCase()}`;
}

// Split `text` on the query and wrap matches in a lav highlight. Case-insensitive.
function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle, from);
  let key = 0;
  while (at !== -1) {
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <mark key={key++} className="hl lav rounded-xs text-ink-2">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Localized labels like "질문자 1" / "Interviewer 1" — first grapheme reads
  // fine as an avatar glyph across ko/en.
  return Array.from(trimmed)[0] ?? '?';
}

function Avatar({ role, name }: { role: TranscriptTurn['role']; name: string }) {
  const cls =
    role === 'guest'
      ? 'bg-amore-bg text-amore'
      : 'bg-sky text-ink-2';
  return (
    <span
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${cls}`}
    >
      {initials(name)}
    </span>
  );
}

function TurnStream({
  turns,
  query,
  view,
}: {
  turns: TranscriptTurn[];
  query: string;
  view: TurnView;
}) {
  if (view === 'timestamp') {
    // 타임스탬프 뷰 — 평평한 로그. 매 turn 이 [시점] + 화자 inline + 발화.
    return (
      <div className="space-y-3">
        {turns.map((turn) => (
          <div key={turn.index} className="flex gap-3 text-md leading-relaxed">
            <span className="shrink-0 font-mono text-xs text-mute-soft tabular-nums">
              {turn.timestamp}
            </span>
            <p className="min-w-0 text-ink-2">
              <span
                className={
                  turn.role === 'guest'
                    ? 'font-semibold text-amore'
                    : 'font-semibold text-ink'
                }
              >
                {highlight(turn.speaker, query)}
              </span>{' '}
              {highlight(turn.text, query)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  // 화자별 뷰(기본) — 연속 동일 화자는 아바타/이름을 한 번만 노출한 버블 스트림.
  return (
    <div className="space-y-4">
      {turns.map((turn, i) => {
        const prev = turns[i - 1];
        const grouped = prev && prev.speaker === turn.speaker;
        return (
          <div key={turn.index} className="flex gap-3">
            <div className="w-8 shrink-0">
              {grouped ? null : <Avatar role={turn.role} name={turn.speaker} />}
            </div>
            <div className="min-w-0 flex-1">
              {grouped ? null : (
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span
                    className={
                      turn.role === 'guest'
                        ? 'text-sm font-semibold text-amore'
                        : 'text-sm font-semibold text-ink'
                    }
                  >
                    {highlight(turn.speaker, query)}
                  </span>
                  <span className="font-mono text-xs text-mute-soft tabular-nums">
                    {turn.timestamp}
                  </span>
                </div>
              )}
              <p className="whitespace-pre-wrap text-md leading-relaxed text-ink-2">
                {highlight(turn.text, query)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExportButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-xs border-2 border-line bg-paper px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:border-amore hover:bg-amore-bg"
    >
      <DuotoneIcon name="document" size={16} fill={LAV_TONE} />
      {label}
    </a>
  );
}

function ComingSoonCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-sm border-2 border-dashed border-line-soft bg-paper-soft px-4 py-4">
      <h4 className="text-sm font-semibold text-ink-2">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-mute-soft">{body}</p>
    </div>
  );
}

export function TranscriptResultFullview({
  job,
  onBack,
  onClose,
}: {
  job: TranscriptJob;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('Features.transcriptResult');
  const tView = useTranslations('Features.transcriptsView');
  const locale = useLocale();

  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [meta, setMeta] = useState<TurnsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<TurnView>('speaker');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset load state when job.id changes
    setLoading(true);
     
    setErrored(false);
    fetch(`/api/transcripts/jobs/${job.id}/turns`)
      .then((r) => (r.ok ? (r.json() as Promise<TurnsResponse>) : Promise.reject()))
      .then((body) => {
        if (cancelled) return;
        setTurns(body.turns);
        setMeta(body.meta);
      })
      .catch(() => {
        if (!cancelled) setErrored(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const displayName = meta?.name ?? job.filename;
  const minutes = formatMinutes(meta?.durationSeconds ?? job.duration_seconds);
  const speakers = meta?.speakers ?? job.speakers_count;
  const langBadge = languageBadge(meta?.language ?? null);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (minutes != null) parts.push(t('minutes', { min: minutes }));
    if (speakers != null) parts.push(t('speakers', { count: speakers }));
    if (langBadge) parts.push(langBadge);
    parts.push(formatDate(meta?.createdAt ?? job.created_at, locale));
    return parts.filter(Boolean).join(' · ');
  }, [minutes, speakers, langBadge, meta?.createdAt, job.created_at, locale, t]);

  // 검색 필터 — 발화/화자 라벨에 매치. 빈 검색이면 전체.
  const filtered = useMemo(() => {
    if (!turns) return [];
    const q = query.trim().toLowerCase();
    if (!q) return turns;
    return turns.filter(
      (turn) =>
        turn.text.toLowerCase().includes(q) ||
        turn.speaker.toLowerCase().includes(q),
    );
  }, [turns, query]);

  const donePill = (
    <span className="rounded-full bg-sky px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-ink-2">
      {t('donePill')}
    </span>
  );

  const backAction = (
    <Button variant="ghost" size="sm" onClick={onBack}>
      ← {t('back')}
    </Button>
  );

  return (
    <WidgetFullviewPanel
      title={`${displayName} · ${t('kind')}`}
      subtitle={subtitle}
      onClose={onClose}
      closeLabel={tView('collapse')}
      tone={LAV_TONE}
      titleDisplay
      badge={donePill}
      headerAction={backAction}
    >
      <div className="flex h-full min-h-0">
        {/* 좌 · 전사록 */}
        <div className="flex min-w-0 flex-1 flex-col border-r-2 border-ink">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-6 py-3">
            <div className="min-w-[200px] flex-1">
              <Input
                fullWidth
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-sm border-2 border-line-soft p-0.5">
              <Button
                variant={view === 'speaker' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView('speaker')}
                aria-pressed={view === 'speaker'}
              >
                {t('bySpeaker')}
              </Button>
              <Button
                variant={view === 'timestamp' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setView('timestamp')}
                aria-pressed={view === 'timestamp'}
              >
                {t('byTimestamp')}
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <p className="py-10 text-center text-md text-mute-soft">
                {t('loading')}
              </p>
            ) : errored ? (
              <p className="py-10 text-center text-md text-mute-soft">
                {t('error')}
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-10 text-center text-md text-mute-soft">
                {query ? t('noResults') : t('empty')}
              </p>
            ) : (
              <TurnStream turns={filtered} query={query} view={view} />
            )}
          </div>
        </div>

        {/* 우 · 사이드바 (340 고정) */}
        <aside className="w-[340px] shrink-0 overflow-y-auto bg-paper px-5 py-5">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <DuotoneIcon name="fullview" size={16} fill={LAV_TONE} />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
                {t('exportTitle')}
              </h3>
            </div>
            <div className="flex flex-col gap-2">
              <ExportButton
                href={`/api/transcripts/jobs/${job.id}/download/docx`}
                label={t('exportDocx')}
              />
              <ExportButton
                href={`/api/transcripts/jobs/${job.id}/download/txt`}
                label={t('exportTxt')}
              />
              <ExportButton
                href={`/api/transcripts/jobs/${job.id}/download/srt`}
                label={t('exportSrt')}
              />
            </div>
          </section>

          {/* AI 요약 · Key themes = T4 후속(LLM 분석 신규 백엔드) — 자리만. */}
          <div className="mt-6 space-y-3">
            <ComingSoonCard
              title={t('aiSummaryTitle')}
              body={t('comingSoon')}
            />
            <ComingSoonCard
              title={t('keyThemesTitle')}
              body={t('comingSoon')}
            />
          </div>
        </aside>
      </div>
    </WidgetFullviewPanel>
  );
}
