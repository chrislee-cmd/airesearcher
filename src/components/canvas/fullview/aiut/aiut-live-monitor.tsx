'use client';

/* ────────────────────────────────────────────────────────────────────
   AiutLiveMonitor — 풀뷰 V2 AI UT 라이브 모니터 본문 (CD state 06).
   design-handoff/FULLVIEW-SHELL.md §F4 (AI UT) · Widget Fullview Comps.dc.html
   state 06.

   fresh 신규 빌드 — 레거시 ut-remote-body 의 라이브 pane 은 supersede.
   로직만 재사용(useUtRemoteSession 의 attachMonitor · captionLines/status ·
   과제/URL). 좌 다크 스크린 모니터(flex 1.7) + 우 레일(320px, 태스크 카드 +
   think-aloud 스트림).

   - 모니터 chrome: bg-ink · titlebar bg-ink-2 · border-strong. 상단 titlebar =
     macOS traffic lights(장식 예외) + URL pill + ● LIVE(rec-soft). 본문 =
     참가자 화면 <video>(현재 보이는 단일 표면에만 부착) 또는 대기 placeholder.
     하단 status bar = REC 경과 + mic/cursor 인디케이터.
   - 태스크 카드: peach 카드(border-2 ink · rounded-sm · shadow-memphis-sm).
     과제 텍스트(assigned task). CD 의 STEP 체크리스트는 구조화 데이터가 없어
     보수적으로 생략(대상 URL 호스트만 보조 노출).
   - think-aloud 스트림: paper-soft 레일 · amore dot 헤더 · 캡션 라인
     (final=ink · interim=mute-soft) auto-scroll. STT idle/error 시 대기 문구.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type {
  UtCaptionLine,
  UtLiveCaptionStatus,
} from '../../widgets/moderator-ai/use-ut-live-caption';

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 대상 URL → 호스트만(monitor titlebar pill). 파싱 실패 시 원문.
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url;
  }
}

// think-aloud 스트림 — 관전 중 참가자 발화 실시간 자막(휘발 by design).
function ThinkAloudStream({
  lines,
  status,
}: {
  lines: UtCaptionLine[];
  status: UtLiveCaptionStatus;
}) {
  const t = useTranslations('AiUt');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const active = status === 'connecting' || status === 'live';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border-[1.4px] border-line paper-soft">
      <div className="flex shrink-0 items-center gap-[7px] border-b border-line px-[14px] py-[11px]">
        <span aria-hidden className="h-2 w-2 rounded-full bg-amore" />
        <span className="text-md font-extrabold text-ink">
          {t('fv.live.thinkAloud')}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[14px] py-3"
        aria-live="polite"
      >
        {!active || lines.length === 0 ? (
          <p className="text-sm italic text-mute-soft">
            {t('fv.live.thinkAloudWaiting')}
          </p>
        ) : (
          lines.map((l) => (
            <p
              key={l.id}
              className={`text-md leading-relaxed ${
                l.final ? 'text-ink' : 'text-mute-soft'
              }`}
            >
              {l.text}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

export function AiutLiveMonitor({
  targetUrl,
  taskGoal,
  recElapsedMs,
  hasParticipantVideo,
  isActiveSurface,
  attachMonitor,
  captionLines,
  captionStatus,
}: {
  targetUrl: string | null;
  taskGoal: string;
  recElapsedMs: number;
  hasParticipantVideo: boolean;
  // 라이브 <video> 는 현재 보이는 단일 표면에만 부착(스트림 단일 sink). 카드가
  // 보이는 동안엔 카드가, 풀뷰가 열리면 풀뷰가 소유한다.
  isActiveSurface: boolean;
  attachMonitor: (el: HTMLVideoElement | null) => void;
  captionLines: UtCaptionLine[];
  captionStatus: UtLiveCaptionStatus;
}) {
  const t = useTranslations('AiUt');
  const host = hostOf(targetUrl);
  const rec = formatElapsed(recElapsedMs);

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-5 py-[18px]">
      {/* 좌 — 다크 스크린 모니터 */}
      <div className="flex min-w-0 flex-[1.7] flex-col overflow-hidden rounded-[var(--fv-radius-panel-lg)] border-[3px] border-ink bg-ink shadow-memphis-md">
        {/* titlebar — traffic lights + URL pill + LIVE */}
        <div className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-[color:var(--border-strong)] bg-ink-2 px-[13px] py-[9px]">
          {/* design-allow-hardcoded -- CD §F4 AI UT traffic lights = literal macOS chrome (장식, 토큰 아님) */}
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span
              key={c}
              aria-hidden
              className="h-[11px] w-[11px] rounded-full"
              style={{ background: c }}
            />
          ))}
          {/* design-allow-hardcoded -- CD §F4 monitor URL pill radius 6 (승격 fv radius 스케일 8~16 밖, 매칭 토큰 없음 — fullview-sidebar 배지 선례) */}
          <div className="ml-2 min-w-0 flex-1 truncate rounded-[6px] bg-ink px-[11px] py-1 font-mono-label text-sm text-faint">
            {host ? `🔒 ${host}` : t('fv.live.urlPlaceholder')}
          </div>
          <span className="shrink-0 font-mono-label text-xs font-bold text-rec-soft">
            ● {t('fv.live.liveTag')}
          </span>
        </div>

        {/* 본문 — 참가자 화면 미러(현재 표면에만 <video>) 또는 대기 placeholder */}
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center bg-paper">
          {isActiveSurface ? (
            <video
              ref={attachMonitor}
              className="h-full w-full bg-ink object-contain"
              autoPlay
              playsInline
            />
          ) : null}
          {!hasParticipantVideo && (
            <span className="pointer-events-none absolute font-mono-label text-sm text-faint">
              {t('fv.live.mirrorWaiting')}
            </span>
          )}
        </div>

        {/* status bar — REC 경과 + mic/cursor */}
        <div className="flex shrink-0 items-center gap-[14px] border-t-[1.5px] border-[color:var(--border-strong)] bg-ink-2 px-[14px] py-[10px]">
          <span className="inline-flex items-center gap-1.5 font-mono-label text-sm font-bold text-rec-soft">
            <span aria-hidden className="h-2 w-2 rounded-full bg-rec" />
            {t('fv.live.recTag')} {rec}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            🎙️ {t('fv.live.micOn')}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-success">
            🖱️ {t('fv.live.cursorTracked')}
          </span>
        </div>
      </div>

      {/* 우 — 태스크 카드 + think-aloud */}
      <div className="flex w-[320px] shrink-0 flex-col gap-[14px]">
        <div className="shrink-0 rounded-sm border-2 border-ink bg-peach-bg px-[15px] py-[13px] shadow-memphis-sm">
          <div className="mb-2 flex items-center gap-[7px]">
            <span aria-hidden className="text-lg">
              🎯
            </span>
            <span className="text-md font-extrabold text-ink">
              {t('fv.live.taskLabel')}
            </span>
          </div>
          <p className="text-md font-bold leading-relaxed text-ink">
            {taskGoal.trim() ? taskGoal : t('fv.live.taskEmpty')}
          </p>
          {host && (
            <p className="mt-2 font-mono-label text-xs text-mute-soft">{host}</p>
          )}
        </div>

        <ThinkAloudStream lines={captionLines} status={captionStatus} />
      </div>
    </div>
  );
}
