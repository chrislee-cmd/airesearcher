'use client';

/* ────────────────────────────────────────────────────────────────────
   UtBehaviorView — AI UT 행동 계량 레이어(카드 622).

   전사 완료 뒤 비전 후처리가 채운 정량 산출물을 보여준다:
     ▸ 지표 카드 — rage-click N · 백트래킹 N · 망설임(횟수/최대 ms) ·
       스크롤 깊이 · 단계 수 · 이벤트 수 · 평균 confidence.
     ▸ 마찰 핫스팟 타임라인 — 시간축 위 마찰 밀집 구간. 클릭 시 녹화를
       인라인 <video> 로 물려 해당 t_ms 로 seek(재생).
     ▸ 단계별 소요시간 — navigate 이벤트로 구획된 단계 막대.

   ⚠ 정량 전용. "무슨 일/왜" 서술·클립은 여기서 만들지 않는다(그건 626).
   ⚠ 추정임을 명시 — 화면 픽셀 기반 추론이라 정밀 DOM 이 아니다. confidence
      낮은 값/이벤트는 흐리게(opacity) 렌더한다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UtEvent, UtEventType } from '@/lib/ut-vision/schema';
import type { BehaviorMetrics } from '@/lib/ut-vision/metrics';

type Props = {
  metrics: BehaviorMetrics | null;
  events: UtEvent[];
  analysisStatus: string; // idle | analyzing | done | error | skipped
  analysisError: string | null;
  durationMs: number | null;
  hasRecording: boolean;
  getPlaybackUrl: () => Promise<string | null>;
};

// 마찰 종류 → 색 토큰. rage/backtrack 은 warning(강), hesitation 은 amore(약).
const FRICTION_TOKEN: Partial<Record<UtEventType, string>> = {
  rage_click: 'bg-warning',
  backtrack: 'bg-warning',
  hover_hesitation: 'bg-amore',
};

function fmtSec(ms: number): string {
  return (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
}

// 지표 카드 하나 — value 는 이미 포맷된 문자열. low(추정 신뢰 낮음) 이면 흐리게.
function MetricCard({
  label,
  value,
  sub,
  low,
}: {
  label: string;
  value: string;
  sub?: string;
  low?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xs border border-line-soft bg-paper-soft px-3 py-2"
      style={low ? { opacity: 0.55 } : undefined}
    >
      <span className="text-xs-soft uppercase tracking-wider text-mute-soft">{label}</span>
      <span className="text-lg font-semibold text-ink">{value}</span>
      {sub && <span className="text-xs-soft text-mute-soft">{sub}</span>}
    </div>
  );
}

export function UtBehaviorView({
  metrics,
  events,
  analysisStatus,
  analysisError,
  durationMs,
  hasRecording,
  getPlaybackUrl,
}: Props) {
  const t = useTranslations('AiUt');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);

  // 핫스팟/이벤트 클릭 → 인라인 재생 + 해당 t_ms 로 seek. 첫 클릭에 서명 URL
  // 을 지연 로드(민감 녹화라 필요할 때만 노출).
  const seekTo = useCallback(
    async (tMs: number) => {
      if (!hasRecording) return;
      setVideoOpen(true);
      let url = videoUrl;
      if (!url) {
        url = await getPlaybackUrl();
        if (!url) return;
        setVideoUrl(url);
      }
      // <video> 가 렌더된 다음 tick 에 seek(막 마운트되면 ref/메타데이터 준비 전).
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (!v) return;
        const doSeek = () => {
          try {
            v.currentTime = Math.max(0, tMs / 1000);
            void v.play().catch(() => {});
          } catch {
            /* seek before metadata — 무시 */
          }
        };
        if (v.readyState >= 1) doSeek();
        else v.addEventListener('loadedmetadata', doSeek, { once: true });
      });
    },
    [hasRecording, videoUrl, getPlaybackUrl],
  );

  // 분석 진행/스킵/에러 상태 배너. idle = done 직후 트리거 전 짧은 공백 →
  // analyzing 과 동일 취급(빈 상태가 깜빡이지 않게).
  if (analysisStatus === 'analyzing' || (analysisStatus === 'idle' && !metrics)) {
    return (
      <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
        {t('behavior.analyzing')}
      </div>
    );
  }
  if (analysisStatus === 'skipped') {
    return (
      <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute-soft">
        {t('behavior.skipped')}
      </div>
    );
  }
  // 에러여도 부분 산출물(있으면)을 보여준다 — 배너만 얹는다.
  const errorBanner =
    analysisStatus === 'error' ? (
      <div className="rounded-xs border border-warning-line bg-warning-bg px-3 py-2 text-xs text-ink-2">
        {t('behavior.error')}
        {analysisError ? ` (${analysisError})` : ''}
      </div>
    ) : null;

  if (!metrics || metrics.event_count === 0) {
    return (
      <div className="flex flex-col gap-2">
        {errorBanner}
        <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute-soft">
          {t('behavior.empty')}
        </div>
      </div>
    );
  }

  const total = (durationMs ?? (events.length ? events[events.length - 1].t_ms : 0)) || 1;
  const lowOverall = metrics.avg_confidence < 0.4;

  return (
    <div className="flex flex-col gap-4">
      {errorBanner}

      {/* 헤더 + 추정 고지 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-mute">
            {t('behavior.title')}
          </h3>
          <span className="text-xs-soft text-mute-soft">
            {t('behavior.confidenceLabel', { pct: Math.round(metrics.avg_confidence * 100) })}
          </span>
        </div>
        <p className="text-xs-soft text-mute-soft">{t('behavior.disclaimer')}</p>
      </div>

      {/* 지표 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MetricCard
          label={t('behavior.metrics.rageClick')}
          value={t('behavior.units.times', { n: metrics.rage_click_count })}
          low={lowOverall}
        />
        <MetricCard
          label={t('behavior.metrics.backtrack')}
          value={t('behavior.units.times', { n: metrics.backtrack_count })}
          low={lowOverall}
        />
        <MetricCard
          label={t('behavior.metrics.hesitation')}
          value={t('behavior.units.times', { n: metrics.hesitation.count })}
          sub={
            metrics.hesitation.max_ms
              ? t('behavior.metrics.hesitationMax', { ms: metrics.hesitation.max_ms })
              : undefined
          }
          low={lowOverall}
        />
        <MetricCard
          label={t('behavior.metrics.scrollDepth')}
          value={`${Math.round(metrics.scroll.max_depth * 100)}%`}
          low={lowOverall}
        />
        <MetricCard
          label={t('behavior.metrics.steps')}
          value={String(metrics.steps.length)}
          low={lowOverall}
        />
        <MetricCard
          label={t('behavior.metrics.events')}
          value={String(metrics.event_count)}
          low={lowOverall}
        />
      </div>

      {/* 마찰 핫스팟 타임라인 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-mute">
            {t('behavior.hotspots.title')}
          </h4>
          {hasRecording && metrics.hotspots.length > 0 && (
            <span className="text-xs-soft text-mute-soft">{t('behavior.hotspots.hint')}</span>
          )}
        </div>

        {/* 시간축 트랙 — 이벤트 틱(연) + 핫스팟 막대(진, 클릭 seek). */}
        <div className="relative h-10 w-full overflow-hidden rounded-xs border border-line-soft bg-paper">
          {/* 이벤트 틱 */}
          {events.map((e, i) => {
            const leftPct = Math.min(100, (e.t_ms / total) * 100);
            const token = FRICTION_TOKEN[e.type] ?? 'bg-mute-soft';
            return (
              <span
                key={`ev-${i}`}
                className={`absolute top-1 h-3 w-px ${token}`}
                style={{ left: `${leftPct}%`, opacity: 0.3 + 0.5 * e.confidence }}
                aria-hidden
              />
            );
          })}
          {/* 핫스팟 막대 — intensity 를 opacity 로. 클릭 시 해당 구간 시작으로 seek. */}
          {metrics.hotspots.map((h, i) => {
            const leftPct = Math.min(100, (h.start_ms / total) * 100);
            const widthPct = Math.max(1.5, Math.min(100 - leftPct, (h.window_ms / total) * 100));
            const maxIntensity = metrics.hotspots[0]?.intensity || 1;
            const opacity = 0.35 + 0.55 * Math.min(1, h.intensity / maxIntensity);
            return (
              // eslint-disable-next-line react/forbid-elements -- 시간축 절대배치 seek 막대(intensity=opacity, left/width=%). Button primitive 의 패딩/variant chrome 이 얇은 바 레이아웃과 맞지 않음. 전용 timeline primitive 는 별 PR.
              <button
                key={`hs-${i}`}
                type="button"
                onClick={() => void seekTo(h.start_ms)}
                disabled={!hasRecording}
                title={t('behavior.hotspots.seekTitle', { time: fmtSec(h.start_ms) })}
                className="absolute bottom-1 top-5 rounded-xs bg-warning transition-opacity hover:opacity-100 disabled:cursor-default"
                style={{ left: `${leftPct}%`, width: `${widthPct}%`, opacity }}
                aria-label={t('behavior.hotspots.seekTitle', { time: fmtSec(h.start_ms) })}
              />
            );
          })}
        </div>
        {metrics.hotspots.length === 0 && (
          <p className="text-xs-soft text-mute-soft">{t('behavior.hotspots.empty')}</p>
        )}

        {/* 인라인 재생 — 핫스팟 클릭 시에만 노출(민감 녹화 지연 로드). */}
        {videoOpen && videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="mt-1 aspect-video w-full rounded-xs border border-line-soft bg-ink"
          />
        )}
      </div>

      {/* 단계별 소요시간 */}
      {metrics.steps.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-mute">
            {t('behavior.steps.title')}
          </h4>
          <div className="flex flex-col gap-1">
            {metrics.steps.map((s) => {
              const widthPct = Math.max(4, Math.min(100, (s.duration_ms / total) * 100));
              return (
                <div key={s.index} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs-soft text-mute-soft">
                    {t('behavior.steps.label', { n: s.index + 1 })}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded-xs bg-paper-soft">
                    <div
                      className="h-full rounded-xs bg-amore"
                      style={{ width: `${widthPct}%`, opacity: lowOverall ? 0.55 : 0.85 }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-xs-soft text-mute">
                    {t('behavior.units.seconds', { n: fmtSec(s.duration_ms) })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
