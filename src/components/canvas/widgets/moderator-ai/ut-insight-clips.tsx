'use client';

/* ────────────────────────────────────────────────────────────────────
   UtInsightClips — AI UT 인사이트 클립(card 626) 리뷰 표면.

   전사 done 후 리서처가 "인사이트 클립 생성" 을 누르면 서버 파이프라인(트웰브랩스
   풀영상 인덱싱 → 순간 탐색 → ffmpeg 클립 → Pegasus 분석 → LLM 리포트)이 돌고,
   진행 상태 → 클립 갤러리 + 세션 인사이트 리포트를 렌더한다. 정량 계량(622,
   UtBehaviorView)과 분리된 **질적** 레이어로 결과 뷰에 공존한다.

   프라이버시: 클립 재생은 클릭 시 서명 URL(inline, 5분)을 발급받아 <video> 에만
   싣는다 — URL 을 미리 노출하지 않는다(622 핫스팟 seek 과 동형).
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { fetchWithAuth } from '@/lib/api/fetch-with-auth';
import {
  useUtInsightClips,
  type InsightClipView,
  type InsightSummary,
} from './use-ut-insight-clips';

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const RUNNING = new Set(['indexing', 'searching', 'clipping', 'analyzing', 'reporting']);

function SeverityBadge({ severity }: { severity?: string }) {
  const t = useTranslations('AiUt');
  if (!severity) return null;
  const tone =
    severity === 'high'
      ? 'border-warning text-warning'
      : severity === 'medium'
        ? 'border-line text-ink-2'
        : 'border-line-soft text-mute';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs-soft ${tone}`}>
      {t(`insight.severity.${severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low'}`)}
    </span>
  );
}

function ClipCard({ sessionId, clip, index }: { sessionId: string; clip: InsightClipView; index: number }) {
  const t = useTranslations('AiUt');
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const play = useCallback(async () => {
    if (url || loading) return;
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
      /* leave url null — button stays available */
    } finally {
      setLoading(false);
    }
  }, [sessionId, clip.id, url, loading]);

  const ins = clip.insight;
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line-soft bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-2">
          #{index + 1} · {clip.theme || t('insight.clipUntitled')}
        </span>
        <span className="text-xs-soft text-mute-soft">
          {mmss(clip.start_ms)}–{mmss(clip.end_ms)}
        </span>
      </div>

      {ins?.summary && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{ins.summary}</p>
      )}
      {ins?.quote && (
        <p className="border-l-2 border-line pl-2 text-sm italic text-mute">“{ins.quote}”</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {ins?.friction && (
          <span className="rounded-full border border-warning px-2 py-0.5 text-xs-soft text-warning">
            {ins.friction}
          </span>
        )}
        {ins?.emotion && (
          <span className="rounded-full border border-line-soft px-2 py-0.5 text-xs-soft text-mute">
            {ins.emotion}
          </span>
        )}
        <SeverityBadge severity={ins?.severity} />
      </div>

      {url ? (
        <video src={url} controls playsInline className="w-full rounded-xs border border-line-soft bg-ink" />
      ) : clip.has_clip ? (
        <div>
          <Button variant="secondary" size="sm" onClick={play} disabled={loading}>
            {loading ? t('insight.playLoading') : t('insight.play')}
          </Button>
        </div>
      ) : (
        <span className="text-xs-soft text-mute-soft">{t('insight.noMedia')}</span>
      )}
    </div>
  );
}

function Report({ summary, clips }: { summary: InsightSummary; clips: InsightClipView[] }) {
  const t = useTranslations('AiUt');
  const ref = (i: number | null) =>
    i != null && clips[i - 1] ? ` (#${i} · ${mmss(clips[i - 1].start_ms)})` : '';
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-paper-soft p-3">
      <h4 className="text-sm font-semibold uppercase tracking-wider text-mute">
        {t('insight.reportTitle')}
      </h4>
      {summary.overview && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{summary.overview}</p>
      )}
      {summary.task_outcome && (
        <div>
          <span className="text-xs-soft font-semibold uppercase tracking-wider text-mute-soft">
            {t('insight.outcome')}
          </span>
          <p className="whitespace-pre-wrap text-sm text-ink-2">{summary.task_outcome}</p>
        </div>
      )}
      {summary.key_themes && summary.key_themes.length > 0 && (
        <div>
          <span className="text-xs-soft font-semibold uppercase tracking-wider text-mute-soft">
            {t('insight.themes')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.key_themes.map((k, i) => (
              <li key={i} className="text-sm text-ink-2">
                <span className="font-semibold">{k.theme}</span> — {k.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.top_frictions && summary.top_frictions.length > 0 && (
        <div>
          <span className="text-xs-soft font-semibold uppercase tracking-wider text-mute-soft">
            {t('insight.frictions')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.top_frictions.map((f, i) => (
              <li key={i} className="text-sm text-ink-2">
                <span className="font-semibold text-warning">{f.title}</span> — {f.detail}
                <span className="text-mute-soft">{ref(f.clip_index)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.notable_quotes && summary.notable_quotes.length > 0 && (
        <div>
          <span className="text-xs-soft font-semibold uppercase tracking-wider text-mute-soft">
            {t('insight.quotes')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.notable_quotes.map((q, i) => (
              <li key={i} className="border-l-2 border-line pl-2 text-sm italic text-mute">
                “{q.quote}”<span className="text-mute-soft not-italic">{ref(q.clip_index)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function UtInsightClips({ sessionId }: { sessionId: string }) {
  const t = useTranslations('AiUt');
  const locale = useLocale();
  // autoStart: the pipeline kicks itself on mount (transcript done + recording
  // present) — no more researcher "Generate" click. Idempotent via the hook's
  // server-status guard. trigger() is kept only for the error "try again" path.
  const { state, running, delayed, trigger } = useUtInsightClips(sessionId, locale, true);

  const status = state?.status ?? 'idle';
  const isRunning = running || RUNNING.has(status);
  // idle before the auto-start GET has kicked in — treat as pending, not opt-in.
  const isPending = status === 'idle' && !isRunning;
  const clips = state?.clips ?? [];
  // Surface a stalled/504 run (still non-terminal) as "delayed + try again" rather
  // than an infinite spinner (card 638 §3). A hard error keeps its own surface.
  const showDelayed = delayed && status !== 'error' && status !== 'done';

  const statusLabel =
    status === 'indexing'
      ? t('insight.statusIndexing')
      : status === 'searching'
        ? t('insight.statusSearching')
        : status === 'clipping'
          ? t('insight.statusClipping', { done: clips.filter((c) => c.has_clip).length, total: clips.length })
          : status === 'analyzing'
            ? t('insight.statusAnalyzing', { done: clips.filter((c) => c.insight).length, total: clips.length })
            : status === 'reporting'
              ? t('insight.statusReporting')
              : '';

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
        {t('insight.title')}
      </h3>

      {isPending && (
        <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
          {t('insight.preparing')}
        </div>
      )}

      {isRunning && !showDelayed && (
        <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
          {statusLabel || t('insight.statusIndexing')}
        </div>
      )}

      {showDelayed && (
        <div className="flex flex-col gap-2 rounded-xs border border-line bg-paper-soft px-3 py-2 text-sm text-ink-2">
          <span>{t('insight.delayed')}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={() => void trigger()}>
              {t('insight.retry')}
            </Button>
          </div>
        </div>
      )}

      {status === 'error' && !isRunning && (
        <div className="flex flex-col gap-2 rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
          <span>{t('insight.error')}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={() => void trigger()}>
              {t('insight.retry')}
            </Button>
          </div>
        </div>
      )}

      {state?.summary && <Report summary={state.summary} clips={clips} />}

      {clips.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs-soft font-semibold uppercase tracking-wider text-mute-soft">
            {t('insight.clipsTitle', { count: clips.length })}
          </span>
          {clips.map((c, i) => (
            <ClipCard key={c.id} sessionId={sessionId} clip={c} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
