'use client';

/* ────────────────────────────────────────────────────────────────────
   AiutReviewReport — 풀뷰 V2 AI UT 사후 리뷰 본문 (CD state 07).
   design-handoff/FULLVIEW-SHELL.md §F4 (AI UT) · Widget Fullview Comps.dc.html
   state 07.

   fresh 신규 빌드 — 레거시 ut-result / ut-insight-clips / ut-behavior-view 의
   프레젠테이션은 supersede. **로직만 재사용**: useUtInsightClips(인사이트 리포트
   +클립 파이프라인) · BehaviorMetrics(정량 산출) · clip play 서명 URL fetch ·
   다운로드/전사 핸들러. 카드뷰(renderContent('card'))는 기존 UtResultView 를
   그대로 유지하므로 회귀 0 — 이 컴포넌트는 풀뷰(모달) 표면에만 쓰인다.

   구성(세로 스크롤): ① 인사이트 리포트(peach 카드 — 과제 + overview + outcome +
   themes/frictions/quotes) ② key clips(3-col 다크 썸네일 그리드, 클릭 재생)
   ③ 행동 메트릭(3-col, estimated=opacity-50) ④ 발화 로그 토글 ⑤ 다운로드.

   CD state 07 은 정량 계량을 6-지표 요약 그리드로만 그린다(핫스팟 타임라인·단계
   막대·seek 은 카드뷰 UtBehaviorView 가 계속 소유). 풀뷰 리뷰가 카드보다 단순한
   것은 CD 의도 — AUTHORITY 상 .dc.html 을 따른다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';
import type { UtPhase, UtSessionResult } from '../../widgets/moderator-ai/use-ut-session';
import {
  useUtInsightClips,
  type InsightClipView,
  type InsightSummary,
} from '../../widgets/moderator-ai/use-ut-insight-clips';
import type { BehaviorMetrics } from '@/lib/ut-vision/metrics';

// Outfit 디스플레이 숫자(메트릭 값, 24/800) — 카드 29px·풀뷰 헤더 22px 와 구분되는
// 리뷰 메트릭 전용 스케일(§F6 off-scale 24 → 인라인). font-family 는 런타임 var.
const METRIC_VALUE_STYLE = {
  fontFamily: 'var(--font-outfit), var(--font-sans)',
  fontSize: '24px',
  fontWeight: 800,
  lineHeight: 1.1,
} as const;

const RUNNING_STATUSES = new Set([
  'indexing',
  'searching',
  'clipping',
  'analyzing',
  'reporting',
]);

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 클립 태그(심각도/마찰) → 채움 pill 토큰. high=pain · medium=confusion · 그 외 중립.
function clipTagTone(clip: InsightClipView): { bg: string; label: string } | null {
  const ins = clip.insight;
  const sev = ins?.severity;
  const label = ins?.friction || clip.theme || '';
  if (!label) return null;
  const bg =
    sev === 'high'
      ? 'bg-tag-pain'
      : sev === 'medium'
        ? 'bg-tag-confusion'
        : 'bg-mute-soft';
  return { bg, label };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[10px] font-mono-label text-xs tracking-[1px] text-mute-soft">
      {children}
    </div>
  );
}

// ── ① 인사이트 리포트 — useUtInsightClips 파이프라인 소비(자동 시작) ──────────
function InsightReport({
  sessionId,
  taskGoal,
}: {
  sessionId: string;
  taskGoal: string;
}) {
  const t = useTranslations('AiUt');
  const locale = useLocale();
  const { state, running, delayed, trigger } = useUtInsightClips(
    sessionId,
    locale,
    true,
  );

  const status = state?.status ?? 'idle';
  const isRunning = running || RUNNING_STATUSES.has(status);
  const isPending = status === 'idle' && !isRunning;
  const clips = state?.clips ?? [];
  const summary = state?.summary ?? null;
  const showDelayed = delayed && status !== 'error' && status !== 'done';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>{t('fv.review.insightReport')}</SectionLabel>
        <div className="rounded-sm border-[1.4px] border-line bg-peach-bg p-4">
          <div className="mb-1.5 text-lg font-bold text-ink">
            {t('fv.review.taskHeading', {
              task: taskGoal.trim() ? taskGoal : t('fv.review.taskFallback'),
            })}
          </div>

          {isPending && (
            <p className="text-md text-mute">{t('insight.preparing')}</p>
          )}
          {isRunning && !showDelayed && (
            <p className="text-md text-mute">{t('fv.review.insightRunning')}</p>
          )}
          {showDelayed && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-md text-ink-2">{t('insight.delayed')}</p>
              <Button variant="secondary" size="sm" onClick={() => void trigger()}>
                {t('insight.retry')}
              </Button>
            </div>
          )}
          {status === 'error' && !isRunning && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-md text-ink-2">{t('insight.error')}</p>
              <Button variant="secondary" size="sm" onClick={() => void trigger()}>
                {t('insight.retry')}
              </Button>
            </div>
          )}

          {summary?.overview && (
            <p className="whitespace-pre-wrap text-md leading-relaxed text-ink-2">
              {summary.overview}
            </p>
          )}
          <InsightDetails summary={summary} clips={clips} />
        </div>
      </div>

      {clips.length > 0 && (
        <div>
          <SectionLabel>
            {t('fv.review.keyClips', { count: clips.length })}
          </SectionLabel>
          <div className="grid grid-cols-3 gap-[11px]">
            {clips.map((c) => (
              <ClipThumb key={c.id} sessionId={sessionId} clip={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 인사이트 리포트 상세(outcome · themes · frictions · quotes) — overview 보강.
function InsightDetails({
  summary,
  clips,
}: {
  summary: InsightSummary | null;
  clips: InsightClipView[];
}) {
  const t = useTranslations('AiUt');
  if (!summary) return null;
  const ref = (i: number | null) =>
    i != null && clips[i - 1] ? ` (#${i} · ${mmss(clips[i - 1].start_ms)})` : '';

  return (
    <div className="mt-3 flex flex-col gap-3">
      {summary.task_outcome && (
        <div>
          <span className="font-mono-label text-xs tracking-[1px] text-mute-soft">
            {t('insight.outcome')}
          </span>
          <p className="whitespace-pre-wrap text-md text-ink-2">
            {summary.task_outcome}
          </p>
        </div>
      )}
      {summary.key_themes && summary.key_themes.length > 0 && (
        <div>
          <span className="font-mono-label text-xs tracking-[1px] text-mute-soft">
            {t('insight.themes')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.key_themes.map((k, i) => (
              <li key={i} className="text-md text-ink-2">
                <span className="font-bold">{k.theme}</span> — {k.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.top_frictions && summary.top_frictions.length > 0 && (
        <div>
          <span className="font-mono-label text-xs tracking-[1px] text-mute-soft">
            {t('insight.frictions')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.top_frictions.map((f, i) => (
              <li key={i} className="text-md text-ink-2">
                <span className="font-bold text-tag-pain">{f.title}</span> —{' '}
                {f.detail}
                <span className="text-mute-soft">{ref(f.clip_index)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.notable_quotes && summary.notable_quotes.length > 0 && (
        <div>
          <span className="font-mono-label text-xs tracking-[1px] text-mute-soft">
            {t('insight.quotes')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.notable_quotes.map((q, i) => (
              <li
                key={i}
                className="border-l-2 border-line pl-2 text-md italic text-mute"
              >
                &ldquo;{q.quote}&rdquo;
                <span className="not-italic text-mute-soft">
                  {ref(q.clip_index)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── ② key clip 썸네일 — 클릭 시 서명 URL(inline) 지연 로드 후 인라인 재생 ──────
function ClipThumb({
  sessionId,
  clip,
}: {
  sessionId: string;
  clip: InsightClipView;
}) {
  const t = useTranslations('AiUt');
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tag = clipTagTone(clip);

  const play = useCallback(async () => {
    if (url || loading || !clip.has_clip) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/ut/sessions/${sessionId}/clips/${clip.id}/play?disposition=inline`,
      );
      if (res.ok) {
        const { url: signed } = (await res.json()) as { url: string };
        setUrl(signed);
      }
    } catch {
      /* leave url null — thumb stays clickable */
    } finally {
      setLoading(false);
    }
  }, [sessionId, clip.id, clip.has_clip, url, loading]);

  return (
    <div className="overflow-hidden rounded-[var(--fv-radius-panel)] border-[1.5px] border-ink shadow-memphis-sm">
      {url ? (
        <video
          src={url}
          controls
          autoPlay
          playsInline
          className="aspect-video w-full bg-ink"
        />
      ) : (
        // eslint-disable-next-line react/forbid-elements -- CD §F4 key-clip 다크 썸네일(80px, ▶ 오버레이 + time 배지). Button primitive 의 패딩/variant chrome 이 풀블리드 썸네일 레이아웃과 맞지 않음(레거시 clip play 선례).
        <button
          type="button"
          onClick={() => void play()}
          disabled={!clip.has_clip || loading}
          className="relative flex h-20 w-full items-center justify-center bg-ink text-paper disabled:cursor-default"
          aria-label={
            clip.has_clip ? t('insight.play') : t('insight.noMedia')
          }
        >
          <span aria-hidden className="text-2xl">
            {clip.has_clip ? '▶' : '—'}
          </span>
          <span className="absolute bottom-1.5 right-[7px] rounded-2xs bg-ink/60 px-1.5 py-px font-mono-label text-xs text-paper">
            {mmss(clip.start_ms)}
          </span>
        </button>
      )}
      <div className="px-[10px] py-[9px]">
        {tag && (
          <span
            className={`mb-1.5 inline-block rounded-pill px-[7px] py-px text-xs font-extrabold text-paper ${tag.bg}`}
          >
            {tag.label}
          </span>
        )}
        <div className="text-sm leading-snug text-ink-2">
          {clip.insight?.summary || clip.theme || t('insight.clipUntitled')}
        </div>
      </div>
    </div>
  );
}

// ── ③ 행동 메트릭 그리드 — 6 지표(estimated=opacity-50) ──────────────────────
function BehaviorMetricsGrid({
  metrics,
  analysisStatus,
}: {
  metrics: BehaviorMetrics | null;
  analysisStatus: string;
}) {
  const t = useTranslations('AiUt');

  if (analysisStatus === 'analyzing' || (analysisStatus === 'idle' && !metrics)) {
    return (
      <div>
        <SectionLabel>{t('fv.review.behavioralMetrics')}</SectionLabel>
        <p className="text-md text-mute">{t('behavior.analyzing')}</p>
      </div>
    );
  }
  if (analysisStatus === 'skipped') return null;
  if (!metrics || metrics.event_count === 0) {
    return (
      <div>
        <SectionLabel>{t('fv.review.behavioralMetrics')}</SectionLabel>
        <p className="text-md text-mute-soft">{t('behavior.empty')}</p>
      </div>
    );
  }

  // estimated — 픽셀 추론이라 신뢰 낮으면(<0.4) 흐리게(opacity-50, §F4).
  const dim = metrics.avg_confidence < 0.4;
  const pct = Math.round(metrics.avg_confidence * 100);
  const cards: { value: string; label: string }[] = [
    {
      value: t('behavior.units.times', { n: metrics.rage_click_count }),
      label: t('behavior.metrics.rageClick'),
    },
    {
      value: t('behavior.units.times', { n: metrics.backtrack_count }),
      label: t('behavior.metrics.backtrack'),
    },
    {
      value: t('behavior.units.times', { n: metrics.hesitation.count }),
      label: t('behavior.metrics.hesitation'),
    },
    {
      value: `${Math.round(metrics.scroll.max_depth * 100)}%`,
      label: t('behavior.metrics.scrollDepth'),
    },
    {
      value: String(metrics.steps.length),
      label: t('behavior.metrics.steps'),
    },
    {
      value: String(metrics.event_count),
      label: t('behavior.metrics.events'),
    },
  ];

  return (
    <div>
      <SectionLabel>
        {t('fv.review.behavioralMetrics')}{' '}
        <span className="text-disabled">
          {t('fv.review.estimatedMeta', { pct })}
        </span>
      </SectionLabel>
      <div className="grid grid-cols-3 gap-[11px]">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-[var(--fv-radius-panel)] border-[1.4px] border-line bg-paper p-[13px] ${
              dim ? 'opacity-50' : ''
            }`}
          >
            <div className="text-ink" style={METRIC_VALUE_STYLE}>
              {c.value}
            </div>
            <div className="mt-0.5 text-sm text-mute-soft">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiutReviewReport({
  phase,
  result,
  error,
  taskGoal,
  onDownloadRecording,
  onDownloadAudio,
  onDownloadTranscript,
  onRetry,
  onReset,
  getPlaybackUrl,
}: {
  phase: UtPhase;
  result: UtSessionResult | null;
  error: string | null;
  taskGoal: string;
  onDownloadRecording: () => void;
  onDownloadAudio: () => void;
  onDownloadTranscript: () => void;
  // 로컬 self-capture 만 재시도 가능(브라우저 blob 보유). 원격은 생략.
  onRetry?: () => void;
  onReset: () => void;
  // 있으면(=로컬 done) 행동 메트릭 그리드 노출. 원격 리뷰는 미전달 → 정량 생략(현 계약 동형).
  getPlaybackUrl?: () => Promise<string | null>;
}) {
  const t = useTranslations('AiUt');
  const transcribing = phase === 'transcribing' || phase === 'uploading';
  const transcript = result?.transcript?.trim();
  const hasRecording = Boolean(result?.has_recording);
  const hasAudio = Boolean(result?.has_audio);
  const [logOpen, setLogOpen] = useState(false);

  const turnCount = transcript
    ? transcript.split(/\n+/).filter((l) => l.trim().length > 0).length
    : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
      {/* 상태 배너 */}
      {transcribing && (
        <div className="rounded-sm border border-line bg-paper-soft px-3 py-2 text-md text-mute">
          {phase === 'uploading'
            ? t('result.uploading')
            : t('result.transcribing')}
        </div>
      )}
      {phase === 'error' && error && (
        <div className="flex flex-col items-start gap-2 rounded-sm border-2 border-warning bg-paper-soft px-3 py-2 text-md text-ink-2">
          <span>{error}</span>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('cta.retryUpload')}
            </Button>
          )}
        </div>
      )}

      {/* ① 인사이트 리포트 + key clips */}
      {phase === 'done' && result && hasRecording && (
        <InsightReport sessionId={result.id} taskGoal={taskGoal} />
      )}

      {/* ③ 행동 메트릭(로컬 done 만 — getPlaybackUrl 전달분) */}
      {phase === 'done' && getPlaybackUrl && result && (
        <BehaviorMetricsGrid
          metrics={result.behavior_metrics}
          analysisStatus={result.analysis_status}
        />
      )}

      {/* ④ 발화 로그 토글 */}
      <div>
        {/* eslint-disable-next-line react/forbid-elements -- CD §F4 발화 로그 full-width 토글 행(🗒️ + 라벨 + 'N turns ▾'). Button primitive 의 variant chrome 이 행 레이아웃과 불일치(probing history-row 선례). */}
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          disabled={!transcript}
          className="flex w-full items-center gap-2 rounded-[var(--fv-radius-panel)] border-[1.4px] border-line bg-paper px-[14px] py-3 text-left disabled:opacity-60"
        >
          <span aria-hidden className="text-lg">
            🗒️
          </span>
          <span className="text-md font-bold text-ink">
            {t('fv.review.utteranceLog')}
          </span>
          <span className="ml-auto text-sm text-mute-soft">
            {turnCount > 0
              ? t('fv.review.turns', { turns: turnCount })
              : ''}{' '}
            {logOpen ? '▴' : '▾'}
          </span>
        </button>
        {logOpen && transcript && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-sm border border-line bg-paper p-3">
            <p className="whitespace-pre-wrap text-md leading-relaxed text-ink-2">
              {transcript}
            </p>
          </div>
        )}
      </div>

      {/* ⑤ 다운로드 — CD 미도시(§3 open item). 기능 보존 위해 유지. */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownloadRecording}
          disabled={!hasRecording}
          title={t('download.recordingTitle')}
        >
          {t('download.recording')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownloadAudio}
          disabled={!hasAudio}
          title={t('download.audioTitle')}
        >
          {t('download.audio')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onDownloadTranscript}
          disabled={!transcript}
          title={t('download.transcriptTitle')}
        >
          {t('download.transcript')}
        </Button>
      </div>

      <div className="flex justify-end border-t border-line pt-3">
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('cta.newSession')}
        </Button>
      </div>
    </div>
  );
}
