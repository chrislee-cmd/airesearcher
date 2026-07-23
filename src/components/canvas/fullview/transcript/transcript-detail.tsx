'use client';

/* ────────────────────────────────────────────────────────────────────
   TranscriptDetail — 전사 풀뷰 V2 상세 (CD state 05).
   design-handoff/FULLVIEW-SHELL.md §F4 Transcript · Widget Fullview Comps.dc.html.

   fresh 신규 빌드 (레거시 transcript-result-fullview 는 supersede — 로직만
   재사용: turns fetch / 검색 / export API). 레이아웃:
   - 좌: 검색 툴바(‹ back · 🔍 search · 화자별/타임스탬프 토글) + 화자 turn
     스트림(아바타 moderator=sky/blue · participant=rose/amore-deep + 이름 +
     타임스탬프 + 발화).
   - 우 rail(340 고정): Export 3버튼(.docx/.txt/.srt) + AI 요약 카드(bg-lav-bg)
     + Key themes(테마 라벨 + 카운트 violet). AI 요약/테마는 신규 백엔드
     (/api/transcripts/jobs/[id]/analysis) — 미생성이면 '생성' CTA(스텁),
     생성 실패/컬럼 미적용(preview) 이면 무해 폴백.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ShareMenu } from '@/components/ui/share-menu';
import type { TranscriptJob } from '@/components/transcript-job-provider';
import type { TranscriptTurn } from '@/lib/transcripts/turns';
import type { TranscriptAnalysis } from '@/lib/transcripts/analysis';
import { languageBadge, minutesFromSeconds, stripExt } from './transcript-format';
import { TranscriptPreview, type TranscriptSource } from './transcript-preview';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

// 검색 매치를 lav 하이라이트로 감싼다 (레거시 highlight 로직 미러, 토큰 기반).
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
      <mark key={key++} className="rounded-2xs bg-lav-bg text-ink-2">
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
  return trimmed ? (Array.from(trimmed)[0] ?? '?') : '?';
}

// CD 아바타/이름 톤 (§F4): moderator=sky bg + blue name · participant=rose bg
// (amore-bg #ffe1eb ≈ CD #ffe0ec) + amore-deep name. neutral=sky bg + ink name.
function avatarTone(role: TranscriptTurn['role']): {
  avatarBg: string;
  nameColor: string;
} {
  if (role === 'guest') {
    return { avatarBg: 'bg-amore-bg', nameColor: 'text-amore-deep' };
  }
  if (role === 'host') {
    return { avatarBg: 'bg-sky', nameColor: 'text-blue' };
  }
  return { avatarBg: 'bg-sky', nameColor: 'text-ink' };
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
    return (
      <div className="flex flex-col gap-3">
        {turns.map((turn) => {
          const { nameColor } = avatarTone(turn.role);
          return (
            <div key={turn.index} className="flex gap-3 text-xl leading-relaxed">
              <span className="shrink-0 font-mono-label text-sm text-faint tabular-nums">
                {turn.timestamp}
              </span>
              <p className="min-w-0 text-ink-2">
                <span className={`font-extrabold ${nameColor}`}>
                  {highlight(turn.speaker, query)}
                </span>{' '}
                {highlight(turn.text, query)}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  // 화자별 뷰 — CD state 05 기본. 매 turn 아바타 + 이름/타임스탬프 + 발화.
  return (
    <div className="flex flex-col gap-[18px]">
      {turns.map((turn) => {
        const { avatarBg, nameColor } = avatarTone(turn.role);
        return (
          <div key={turn.index} className="flex gap-[13px]">
            <span
              aria-hidden
              className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-2 border-ink text-lg font-extrabold text-ink ${avatarBg}`}
            >
              {initials(turn.speaker)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline gap-[9px]">
                <span className={`text-lg font-extrabold ${nameColor}`}>
                  {highlight(turn.speaker, query)}
                </span>
                <span className="font-mono-label text-sm text-faint tabular-nums">
                  {turn.timestamp}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-xl leading-[1.65] text-ink-2">
                {highlight(turn.text, query)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Export 카드 (docx/txt/srt) — border 1.5 ink · rounded-panel · memphis-sm.
function ExportCard({
  href,
  emoji,
  label,
}: {
  href: string;
  emoji: string;
  label: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-1 flex-col items-center gap-1.5 rounded-[var(--fv-radius-panel)] border-[1.5px] border-ink px-1.5 py-3 shadow-memphis-sm transition-colors hover:bg-lav-bg"
    >
      <span aria-hidden className="text-2xl">
        {emoji}
      </span>
      <span className="text-sm font-bold text-ink">{label}</span>
    </a>
  );
}

// 우 rail 섹션 헤더 — mono 10 캡션.
function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 font-mono-label text-xs font-bold uppercase tracking-[1px] text-mute-soft">
      {children}
    </div>
  );
}

// AI 요약 + Key themes rail (신규 백엔드). analysis 소스: GET → 있으면 렌더,
// 없으면 '생성' CTA(done 잡). POST 로 on-demand 생성.
function AnalysisRail({ job }: { job: TranscriptJob }) {
  const t = useTranslations('Features.transcriptResult');
  const [analysis, setAnalysis] = useState<TranscriptAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // null=아직 시도 없음 · 'ok'=성공 · 'empty'=생성했으나 결과 없음(무해 폴백).
  const [genResult, setGenResult] = useState<'empty' | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- job.id 변경 시 analysis 로드 상태 리셋(레거시 result-fullview 동형).
    setLoading(true);
    setAnalysis(null);
    setGenResult(null);
    fetch(`/api/transcripts/jobs/${job.id}/analysis`)
      .then((r) => (r.ok ? (r.json() as Promise<{ analysis: TranscriptAnalysis | null }>) : Promise.reject()))
      .then((body) => {
        if (!cancelled) setAnalysis(body.analysis);
      })
      .catch(() => {
        // GET 실패(권한/네트워크) — 스텁(생성 CTA)으로 폴백.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const generate = () => {
    if (generating) return;
    setGenerating(true);
    setGenResult(null);
    fetch(`/api/transcripts/jobs/${job.id}/analysis`, { method: 'POST' })
      .then((r) => (r.ok ? (r.json() as Promise<{ analysis: TranscriptAnalysis | null }>) : Promise.reject()))
      .then((body) => {
        if (body.analysis) setAnalysis(body.analysis);
        else setGenResult('empty');
      })
      .catch(() => setGenResult('empty'))
      .finally(() => setGenerating(false));
  };

  return (
    <>
      <div>
        <RailLabel>{t('aiSummaryTitle')}</RailLabel>
        {loading ? (
          <p className="text-md text-mute-soft">{t('loading')}</p>
        ) : analysis ? (
          <div className="rounded-sm border-[1.5px] border-line bg-lav-bg p-[14px]">
            <p className="text-lg leading-[1.6] text-ink-2">{analysis.summary}</p>
          </div>
        ) : (
          <div className="rounded-sm border-2 border-dashed border-line-soft bg-paper-soft px-4 py-4">
            <p className="text-sm leading-relaxed text-mute-soft">
              {genResult === 'empty' ? t('summaryUnavailable') : t('summaryStub')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={generate}
              loading={generating}
              loadingLabel={t('generating')}
              disabled={generating}
            >
              {t('generate')}
            </Button>
          </div>
        )}
      </div>

      {analysis && analysis.themes.length > 0 && (
        <div>
          <RailLabel>{t('keyThemesTitle')}</RailLabel>
          <div className="flex flex-col gap-2">
            {analysis.themes.map((theme, i) => (
              <div
                key={`${theme.label}-${i}`}
                className="flex items-center gap-2.5 rounded-[var(--fv-radius-panel)] border-[1.4px] border-line px-3 py-2.5"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full bg-violet"
                />
                <span className="min-w-0 flex-1 text-md font-semibold text-ink">
                  {theme.label}
                </span>
                <span className="font-mono-label text-sm font-bold text-violet">
                  ×{theme.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function TranscriptDetail({
  job,
  onBack,
}: {
  job: TranscriptJob;
  onBack: () => void;
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
  // 정제본/원본 소스 토글 (레거시 JobRow 동형). export 링크 + Google Docs
  // 공유 + 미리보기가 모두 이 값을 따른다. 기본 clean (다운로드 라우트 기본과
  // 일치 — 토글 전에는 ?source 쿼리 없음).
  const [source, setSource] = useState<TranscriptSource>('clean');
  const [previewOpen, setPreviewOpen] = useState(false);
  const downloadSuffix = source === 'raw' ? '?source=raw' : '';

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- job.id 변경 시 turns 로드 상태 리셋(레거시 result-fullview 동형).
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

  const displayName = meta?.name ?? (stripExt(job.filename) || t('kind'));

  // 상세 헤더/툴바 컨텍스트 라인 — 분/화자/언어/날짜.
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    const min = minutesFromSeconds(meta?.durationSeconds ?? job.duration_seconds);
    if (min != null) parts.push(t('minutes', { min }));
    const sp = meta?.speakers ?? job.speakers_count;
    if (sp != null) parts.push(t('speakers', { count: sp }));
    const lang = languageBadge(meta?.language ?? null);
    if (lang) parts.push(lang);
    return parts.join(' · ');
  }, [meta, job.duration_seconds, job.speakers_count, t]);

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

  return (
    <>
    <div className="flex min-h-0 flex-1">
      {/* 좌 · 전사록 */}
      <div className="flex min-w-0 flex-1 flex-col border-r-2 border-ink">
        {/* 검색 툴바 (CD state 05) */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line-soft bg-paper px-[22px] py-3">
          {/* eslint-disable-next-line react/forbid-elements -- CD state 05 back ‹ 는 36px 원형 chrome(border 1.5 ink·memphis-sm) — IconButton 고정 radius variant 와 불일치(fullview-header 닫기✕ 선례). */}
          <button
            type="button"
            onClick={onBack}
            aria-label={t('back')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink bg-paper text-lg font-bold text-ink shadow-memphis-sm"
          >
            ‹
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-pill border-[1.5px] border-line bg-paper-soft px-3.5 py-2">
            <span aria-hidden className="text-lg text-mute-soft">
              🔍
            </span>
            {/* eslint-disable-next-line react/forbid-elements -- CD state 05 검색은 rounded-pill·paper-soft·🔍 prefix inline 필드 — Input primitive(border-line·rounded-sm 박스)와 시각 불일치. CD 전용 chrome. */}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-lg text-ink placeholder:text-faint focus:outline-none"
            />
          </div>
          {/* eslint-disable-next-line react/forbid-elements -- CD state 05 화자별/타임스탬프 토글 pill(rounded-pill outline, active=ink/inactive=mute-soft) — Button primitive variant 와 불일치. aria-pressed 로 상태 노출. */}
          <button
            type="button"
            aria-pressed={view === 'speaker'}
            onClick={() => setView('speaker')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] px-3 py-2 text-md ${
              view === 'speaker'
                ? 'border-ink font-bold text-ink'
                : 'border-line font-semibold text-mute-soft'
            }`}
          >
            🗣️ {t('bySpeaker')}
          </button>
          {/* eslint-disable-next-line react/forbid-elements -- 위 토글과 동일 CD chrome 쌍. */}
          <button
            type="button"
            aria-pressed={view === 'timestamp'}
            onClick={() => setView('timestamp')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] px-3 py-2 text-md ${
              view === 'timestamp'
                ? 'border-ink font-bold text-ink'
                : 'border-line font-semibold text-mute-soft'
            }`}
          >
            🕐 {t('byTimestamp')}
          </button>
        </div>

        {/* turn 스트림 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-5">
          {loading ? (
            <p className="py-10 text-center text-xl text-mute-soft">{t('loading')}</p>
          ) : errored ? (
            <p className="py-10 text-center text-xl text-mute-soft">{t('error')}</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-xl text-mute-soft">
              {query ? t('noResults') : t('empty')}
            </p>
          ) : (
            <TurnStream turns={filtered} query={query} view={view} />
          )}
        </div>
      </div>

      {/* 우 rail (340 고정) */}
      <aside className="flex w-[340px] shrink-0 flex-col gap-[18px] overflow-y-auto bg-paper px-[18px] pb-6 pt-[18px]">
        {/* 상세 컨텍스트 라인 (파일명 + 분/화자/언어). shell 헤더 타이틀은
            위젯 라벨 고정(§F7.3 — 셸이 헤더 타이틀 소유)이라 파일명·메타는
            여기서 노출. */}
        <div>
          <div className="truncate font-mono-label text-lg font-bold text-ink">
            {displayName}
          </div>
          {contextLine && (
            <div className="mt-0.5 text-sm text-mute-soft">{contextLine}</div>
          )}
        </div>

        <div>
          <RailLabel>{t('exportTitle')}</RailLabel>
          {/* 라벨 = 파일 포맷 토큰(.docx/.md/.txt/.srt) — 로케일 불변. 링크는
              소스 토글(정제본/원본)을 따른다(download 라우트 재사용). */}
          <div className="grid grid-cols-2 gap-2">
            <ExportCard
              href={`/api/transcripts/jobs/${job.id}/download/docx${downloadSuffix}`}
              emoji="📄"
              label=".docx"
            />
            <ExportCard
              href={`/api/transcripts/jobs/${job.id}/download/md${downloadSuffix}`}
              emoji="📑"
              label=".md"
            />
            <ExportCard
              href={`/api/transcripts/jobs/${job.id}/download/txt${downloadSuffix}`}
              emoji="📝"
              label=".txt"
            />
            <ExportCard
              href={`/api/transcripts/jobs/${job.id}/download/srt${downloadSuffix}`}
              emoji="🎬"
              label=".srt"
            />
          </div>
          {/* Google Docs 공유(서버 빌드 docx blob 재사용 → Drive 변환) +
              미리보기 토글(preview 라우트 재사용, 소스 토글은 모달 안). */}
          <div className="mt-2.5 flex items-center gap-2">
            <ShareMenu
              align="start"
              items={[
                {
                  destination: 'google-docs',
                  title: displayName,
                  getBlob: async () => {
                    const r = await fetch(
                      `/api/transcripts/jobs/${job.id}/download/docx${downloadSuffix}`,
                    );
                    return { blob: await r.blob(), mimeType: DOCX_MIME };
                  },
                },
              ]}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPreviewOpen(true)}
            >
              {tView('preview')}
            </Button>
          </div>
        </div>

        <AnalysisRail job={job} />
      </aside>
    </div>

    {/* docx 미리보기 모달 — rail 폭(340) 이 docx 프리뷰에 부족해 full-width
        모달로(레거시 previewMode='modal' 동형). 소스 토글은 모달 안. */}
    <Modal
      open={previewOpen}
      onClose={() => setPreviewOpen(false)}
      title={displayName}
      size="lg"
    >
      <TranscriptPreview id={job.id} source={source} setSource={setSource} />
    </Modal>
    </>
  );
}
