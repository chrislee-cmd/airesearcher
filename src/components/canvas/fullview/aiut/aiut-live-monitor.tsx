'use client';

/* ────────────────────────────────────────────────────────────────────
   AiutLiveMonitor — 풀뷰 V2 AI UT 모니터 본문 (CD state 06).
   design-handoff/FULLVIEW-SHELL.md §F4 (AI UT) · Widget Fullview Comps.dc.html
   state 06.

   fresh 신규 빌드 — 레거시 ut-remote-body 의 라이브 pane 은 supersede.
   로직만 재사용(useUtRemoteSession 의 attachMonitor · captionLines/status ·
   과제/URL). 좌 다크 스크린 모니터(flex 1.7) + 우 레일(320px, 태스크 카드 +
   think-aloud 스트림).

   두 variant — 동일 컴포넌트/동일 지오메트리(드리프트 0):
   - `live` (기본): 참가자 화면 라이브 관전. titlebar ● LIVE·활성 status bar·
     참가자 <video> 또는 대기 placeholder·태스크 카드·think-aloud 캡션.
   - `idle`: 세션 시작 前(세팅/공유대기) 및 로컬 라이브 녹화의 empty case
     프레임. state 06 지오메트리를 그대로 두고 콘텐츠만 슬롯으로 채운다 —
     위젯(카드) 본문 폴백 제거(2026-07-26 사용자 결정: 풀뷰 디폴트 = state 06
     empty). 모니터 본문 = `monitorSlot`(placeholder+CTA 또는 로컬 프리뷰),
     우 레일 태스크 카드 자리 = `railCardSlot`(세팅/공유 패널). LIVE chip 은
     `statusTone==='rec'`(로컬 녹화 중)일 때만.

   - 모니터 chrome: bg-ink · titlebar bg-ink-2 · border-strong. 상단 titlebar =
     macOS traffic lights(장식 예외) + URL pill + ● LIVE(rec-soft). 본문 =
     참가자 화면 <video>(현재 보이는 단일 표면에만 부착) 또는 대기 placeholder.
     하단 status bar = REC 경과 + mic/cursor 인디케이터(idle 시 비활성 표기).
   - 태스크 카드: peach 카드(border-2 ink · rounded-sm · shadow-memphis-sm).
     과제 텍스트(assigned task). CD 의 STEP 체크리스트는 구조화 데이터가 없어
     보수적으로 생략(대상 URL 호스트만 보조 노출).
   - think-aloud 스트림: paper-soft 레일 · amore dot 헤더 · 캡션 라인
     (final=ink · interim=mute-soft) auto-scroll. STT idle/error 시 대기 문구.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, type ReactNode } from 'react';
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

// ── 공유 프레임 클래스(live/idle 동일 지오메트리 — 픽셀 conformance SSOT) ──
const OUTER = 'flex min-h-0 flex-1 gap-4 px-5 py-[18px]';
const MONITOR_FRAME =
  'flex min-w-0 flex-[1.7] flex-col overflow-hidden rounded-[var(--fv-radius-panel-lg)] border-[3px] border-ink bg-ink shadow-memphis-md';
const TITLEBAR =
  'flex shrink-0 items-center gap-2 border-b-[1.5px] border-[color:var(--border-strong)] bg-ink-2 px-[13px] py-[9px]';
const MONITOR_BODY =
  'relative flex min-h-0 flex-1 flex-col items-center justify-center bg-paper';
// idle 본문 — 슬롯(세팅 폼/대기 placeholder/로컬 프리뷰)이 자체 정렬. 강제
// 중앙정렬 안 함(긴 세팅 폼이 잘리지 않도록).
const MONITOR_BODY_IDLE = 'relative flex min-h-0 flex-1 flex-col bg-paper';
const STATUSBAR =
  'flex shrink-0 items-center gap-[14px] border-t-[1.5px] border-[color:var(--border-strong)] bg-ink-2 px-[14px] py-[10px]';
const RAIL = 'flex w-[320px] shrink-0 flex-col gap-[14px]';

// macOS traffic lights — 장식(design-allow), 토큰 아님. live/idle 공유.
function TrafficLights() {
  return (
    <>
      {/* design-allow-hardcoded -- CD §F4 AI UT traffic lights = literal macOS chrome (장식, 토큰 아님) */}
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <span
          key={c}
          aria-hidden
          className="h-[11px] w-[11px] rounded-full"
          style={{ background: c }}
        />
      ))}
    </>
  );
}

// titlebar URL pill — host 있으면 활성(faint), 없으면 비활성 placeholder(mute-soft).
function UrlPill({ host }: { host: string | null }) {
  const t = useTranslations('AiUt');
  const tone = host ? 'text-faint' : 'text-mute-soft';
  return (
    <>
      {/* design-allow-hardcoded -- CD §F4 monitor URL pill radius 6 (승격 fv radius 스케일 8~16 밖, 매칭 토큰 없음 — fullview-sidebar 배지 선례) */}
      <div className={`ml-2 min-w-0 flex-1 truncate rounded-[6px] bg-ink px-[11px] py-1 font-mono-label text-sm ${tone}`}>
        {host ? `🔒 ${host}` : t('fv.live.urlPlaceholder')}
      </div>
    </>
  );
}

// 태스크 카드(우 레일 상단) — assigned task. live/idle 공유(드리프트 0).
// 과제 있으면 peach 솔리드 카드, 없으면(empty case) §F4 dashed empty 토큰.
function TaskCard({
  taskGoal,
  host,
}: {
  taskGoal: string;
  host: string | null;
}) {
  const t = useTranslations('AiUt');
  const hasTask = taskGoal.trim().length > 0;
  return (
    <div
      className={`shrink-0 rounded-sm px-[15px] py-[13px] ${
        hasTask
          ? 'border-2 border-ink bg-peach-bg shadow-memphis-sm'
          : 'border-2 border-dashed border-line-empty bg-paper-soft'
      }`}
    >
      <div className="mb-2 flex items-center gap-[7px]">
        <span aria-hidden className="text-lg">
          🎯
        </span>
        <span className="text-md font-extrabold text-ink">
          {t('fv.live.taskLabel')}
        </span>
      </div>
      <p
        className={`text-md font-bold leading-relaxed ${
          hasTask ? 'text-ink' : 'text-mute-soft'
        }`}
      >
        {hasTask ? taskGoal : t('fv.live.taskEmpty')}
      </p>
      {hasTask && host && (
        <p className="mt-2 font-mono-label text-xs text-mute-soft">{host}</p>
      )}
    </div>
  );
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

type LiveProps = {
  variant?: 'live';
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
};

type IdleProps = {
  variant: 'idle';
  targetUrl: string | null;
  // 모니터 본문(세팅 폼+CTA / 대기 placeholder / 로컬 프리뷰). 부모가 로직 배선.
  monitorSlot: ReactNode;
  // 우 레일 상단 assigned task 카드 데이터(design state 06). railCardSlot 미전달
  // 시 이 값으로 TaskCard 렌더 — 공유대기 등 다른 카드는 railCardSlot 로 override.
  taskGoal?: string;
  // 우 레일 상단 카드 override(공유 링크 패널 등). 미전달이면 TaskCard.
  railCardSlot?: ReactNode;
  // status bar 톤 — 'idle'(비활성, 00:00 muted) / 'rec'(로컬 녹화 중, 경과).
  statusTone?: 'idle' | 'rec';
  recElapsedMs?: number;
  // think-aloud 레일 노출(기본 true). idle 대기 문구를 그대로 유지.
  showThinkAloud?: boolean;
};

type Props = LiveProps | IdleProps;

export function AiutLiveMonitor(props: Props) {
  const t = useTranslations('AiUt');
  const host = hostOf(props.targetUrl);

  // ── idle variant — 세팅/공유대기/로컬 녹화 empty case 프레임 ──────────
  if (props.variant === 'idle') {
    const { monitorSlot, railCardSlot } = props;
    const railCard = railCardSlot ?? (
      <TaskCard taskGoal={props.taskGoal ?? ''} host={host} />
    );
    const statusTone = props.statusTone ?? 'idle';
    const isRec = statusTone === 'rec';
    const showThinkAloud = props.showThinkAloud ?? true;
    const rec = formatElapsed(props.recElapsedMs ?? 0);

    return (
      <div className={OUTER}>
        {/* 좌 — 다크 스크린 모니터(라이브와 동일 프레임) */}
        <div className={MONITOR_FRAME}>
          <div className={TITLEBAR}>
            <TrafficLights />
            <UrlPill host={host} />
            {isRec && (
              <span className="shrink-0 font-mono-label text-xs font-bold text-rec-soft">
                ● {t('fv.live.recTag')}
              </span>
            )}
          </div>

          {/* 본문 — 세팅 폼+CTA / 대기 placeholder / 로컬 프리뷰(부모 슬롯) */}
          <div className={MONITOR_BODY_IDLE}>{monitorSlot}</div>

          {/* status bar — idle 은 비활성(muted 00:00), rec 은 경과 활성 */}
          <div className={STATUSBAR}>
            <span
              className={`inline-flex items-center gap-1.5 font-mono-label text-sm font-bold ${
                isRec ? 'text-rec-soft' : 'text-mute-soft'
              }`}
            >
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${isRec ? 'bg-rec' : 'bg-mute-soft'}`}
              />
              {t('fv.live.recTag')} {rec}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-sm ${
                isRec ? 'text-success' : 'text-mute-soft'
              }`}
            >
              🎙️ {isRec ? t('fv.live.micOn') : t('fv.idle.micIdle')}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-sm ${
                isRec ? 'text-success' : 'text-mute-soft'
              }`}
            >
              🖱️ {isRec ? t('fv.live.cursorTracked') : t('fv.idle.cursorIdle')}
            </span>
          </div>
        </div>

        {/* 우 — assigned task 카드(design state 06) + think-aloud 대기.
            공유대기 등은 railCardSlot 로 카드를 override(레일 채움). */}
        <div className={RAIL}>
          {railCardSlot ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {railCardSlot}
            </div>
          ) : (
            railCard
          )}
          {showThinkAloud && (
            <ThinkAloudStream lines={[]} status="idle" />
          )}
        </div>
      </div>
    );
  }

  // ── live variant (기본) — 참가자 화면 라이브 관전 ────────────────────
  const {
    taskGoal,
    recElapsedMs,
    hasParticipantVideo,
    isActiveSurface,
    attachMonitor,
    captionLines,
    captionStatus,
  } = props;
  const rec = formatElapsed(recElapsedMs);

  return (
    <div className={OUTER}>
      {/* 좌 — 다크 스크린 모니터 */}
      <div className={MONITOR_FRAME}>
        {/* titlebar — traffic lights + URL pill + LIVE */}
        <div className={TITLEBAR}>
          <TrafficLights />
          <UrlPill host={host} />
          <span className="shrink-0 font-mono-label text-xs font-bold text-rec-soft">
            ● {t('fv.live.liveTag')}
          </span>
        </div>

        {/* 본문 — 참가자 화면 미러(현재 표면에만 <video>) 또는 대기 placeholder */}
        <div className={MONITOR_BODY}>
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
        <div className={STATUSBAR}>
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
      <div className={RAIL}>
        <TaskCard taskGoal={taskGoal} host={host} />
        <ThinkAloudStream lines={captionLines} status={captionStatus} />
      </div>
    </div>
  );
}
