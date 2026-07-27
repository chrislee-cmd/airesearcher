'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetGuideModal — 위젯 헤더 툴바 `?` 버튼이 여는 per-위젯 how-to 영상
   모달 (CD widget-toolbar-guide §4).

   프레임 = CD .dc.html 이 SSOT: 3px ink border · radius 18 · 8px offset
   shadow · header(위젯 pastel) / player(bg-ink · 16:9) / footer(paper-soft)
   3단 세로 구성. ⚠️ `max-height:100% + min-height:0 + overflow:hidden` 은
   필수 — 짧은 뷰포트(~540-650px)에서 player 가 먼저 shrink 해 헤더 ✕ 와
   footer 가 화면 밖으로 안 밀린다.

   재사용: ui/Modal 의 `bare` 모드 — Esc·백드롭·스크롤락·포커스트랩·portal·
   enter/leave 애니메이션을 그대로 상속하고, CD chrome 은 children 이 통째로
   소유한다. (bare 는 SIZE 프리셋 폭만 남기므로 xl 패널 안에 860px 카드를
   가운데 두고, 카드 밖 여백 클릭도 닫히도록 outer wrapper 에 onClose 를 건다.)

   영상: 네이티브 <video> + 커스텀 컨트롤(CD 74px play 버튼 · 하단 스크럽바).
   네이티브 컨트롤은 숨기고 CD chrome 을 재현 — 재생/시크/시간표시만 최소 배선.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import type { AccentColor } from '../widget-types';
import type { WidgetGuide } from '@/lib/widget-guides';

// 초 → "m:ss" (CD 스크럽바 시간 표기).
function formatTime(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

// CD 헤더 글리프 — `?` 원 + 재생 삼각형(19px). decorative + aria-hidden.
function GuideHeaderIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--canvas-card-border)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path
        d="M10.2 8.6l5.2 3.4-5.2 3.4z"
        fill="var(--canvas-card-border)"
        strokeWidth="1.6"
      />
    </svg>
  );
}

// CD 재생 삼각형(30px, ink fill). play 버튼 안.
function PlayTriangle() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="var(--color-ink)" aria-hidden="true">
      <path d="M8 5.5l11 6.5-11 6.5z" />
    </svg>
  );
}

// CD 일시정지 글리프(30px, ink fill) — 재생 중 play 버튼 대체.
function PauseGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="var(--color-ink)" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  // 닫힘 exit 애니메이션 동안에도 내용이 남도록 부모는 close 후에도 guide 를
  // 잠시 유지한다(fullview 패턴). guide 가 null 이면 렌더 안 함.
  guide: WidgetGuide | null;
  // 해석된 위젯 라벨 ("How to use · {name}").
  widgetName: string;
  // 헤더 pastel 톤 — 위젯 meta.accent (config 아님, 카드 헤더와 자동 일치).
  accent: AccentColor;
};

export function WidgetGuideModal({
  open,
  onClose,
  guide,
  widgetName,
  accent,
}: Props) {
  const t = useTranslations();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // 모달 닫히면 영상 정지 + 처음으로 되감기 → 다음 오픈 시 poster + play 버튼
  // (CD "not-yet-playing") 상태로 복귀.
  useEffect(() => {
    if (open) return;
    const v = videoRef.current;
    if (v) {
      v.pause();
      try {
        v.currentTime = 0;
      } catch {
        /* metadata 미로드 시 무시 */
      }
    }
    // 닫힘(Esc/백드롭/✕ 모든 경로)에서 UI 를 not-yet-playing 으로 리셋.
    // 컴포넌트가 상시 마운트라 <video> 가 이전 위치/재생 상태를 유지하므로
    // 여기서 동기 리셋이 필요(외부 시스템=video element 와의 동기화).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close 시 video element 리셋과 함께 UI 상태 동기 리셋
    setPlaying(false);
    setCurrent(0);
  }, [open]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekFromEvent = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      v.currentTime = Math.max(0, Math.min(1, ratio)) * v.duration;
    },
    [],
  );

  if (!guide) return null;

  const totalLabel = duration > 0 ? formatTime(duration) : guide.durationLabel;
  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const playLabel = t('WidgetGuide.play');

  // CD 프레임 카드 — bare 패널 안의 유일한 비주얼 박스. radius 18 / 3px border /
  // 8px offset shadow 는 CD 절대값이라 inline(토큰 매핑 없음). shadow 는 앱
  // 모달 관례(shadow-memphis-2xl = 8px8px0 ink)를 토큰으로 재사용.
  const cardStyle: CSSProperties = {
    maxWidth: 860,
    // p-4(16px×2) 오버레이 여백을 뺀 뷰포트 높이. 짧은 뷰포트에서 카드가
    // 이 값으로 clamp 되고 player(flex-1 min-h-0)가 먼저 shrink.
    maxHeight: 'calc(100dvh - 2rem)',
    border: '3px solid var(--canvas-card-border)',
    borderRadius: 18,
    boxShadow: 'var(--shadow-memphis-2xl)',
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      bare
      size="xl"
      dsPrimitive="WidgetGuideModal"
    >
      {/* bare 패널(xl=max-w-1100) 안에서 카드를 가운데 두고, 카드 밖 여백
          클릭도 닫히게 outer wrapper 에 onClose. 카드는 stopPropagation. */}
      <div
        className="flex h-full w-full items-center justify-center"
        onClick={onClose}
      >
        <div
          className="flex w-full min-h-0 flex-col overflow-hidden bg-paper"
          style={cardStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — 위젯 pastel bg · 2px ink bottom border. */}
          <div
            className="flex shrink-0 items-center gap-[11px] border-b-2 border-ink"
            style={{
              background: `var(--widget-header-bg-${accent}, var(--widget-header-bg-default))`,
              padding: '13px 20px',
            }}
          >
            <GuideHeaderIcon />
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-ink"
                style={{
                  fontFamily: 'var(--font-outfit), var(--font-sans)',
                  fontSize: 19,
                  fontWeight: 800,
                  letterSpacing: '-0.4px',
                }}
              >
                {t('WidgetGuide.title', { name: widgetName })}
              </div>
            </div>
            {/* duration pill — paper · 1.5px ink · pill · mono 10.5/700. */}
            <span
              className="inline-flex shrink-0 items-center rounded-full bg-paper font-mono font-bold text-ink"
              style={{
                border: '1.5px solid var(--canvas-card-border)',
                padding: '4px 11px',
                fontSize: 10.5,
              }}
            >
              {guide.durationLabel}
            </span>
            {/* close ✕ — 30px · 1.5px ink · radius 9 · shadow-memphis-sm. */}
            {/* eslint-disable-next-line react/forbid-elements -- CD 전용 30px ✕ 칩(1.5px border·radius9·memphis-sm). ui/IconButton chrome 과 지오메트리 불일치 → 셸 툴바 세그 버튼과 동일 사유. */}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('WidgetGuide.close')}
              className="inline-flex shrink-0 items-center justify-center bg-paper text-ink shadow-memphis-sm"
              style={{
                width: 30,
                height: 30,
                border: '1.5px solid var(--canvas-card-border)',
                borderRadius: 9,
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>

          {/* Player — bg-ink · 16:9 · flex-1 min-h-0 (먼저 shrink). */}
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-ink"
            style={{ aspectRatio: '16 / 9' }}
          >
            <video
              ref={videoRef}
              poster={guide.posterUrl}
              preload="metadata"
              playsInline
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ background: 'var(--color-ink)' }}
            >
              <source src={guide.videoUrl} type="video/mp4" />
            </video>

            {/* 74px play 버튼 — 정지 상태에서만 노출(CD not-yet-playing). */}
            {!playing && (
              // eslint-disable-next-line react/forbid-elements -- CD 전용 74px 원형 play 오버레이(반투명 화이트·3px ink·4px offset). ui/Button chrome 과 지오메트리 불일치.
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playLabel}
                title={playLabel}
                className="relative inline-flex items-center justify-center rounded-full bg-white/95"
                style={{
                  width: 74,
                  height: 74,
                  border: '3px solid var(--canvas-card-border)',
                  boxShadow: 'var(--shadow-memphis-lg)',
                }}
              >
                <PlayTriangle />
              </button>
            )}

            {/* 하단 스크럽바 — 그라디언트 · mono 시간 · amore 진행 채움. */}
            <div
              className="absolute inset-x-0 bottom-0 flex items-center gap-[11px] bg-gradient-to-b from-transparent to-black/55"
              style={{ padding: '12px 16px' }}
            >
              {/* 재생 중이면 스크럽바에 pause 토글(정지 시엔 큰 play 버튼이 담당). */}
              {playing && (
                // eslint-disable-next-line react/forbid-elements -- 스크럽바 인라인 pause 토글(bare 아이콘). ui/IconButton chrome 은 어두운 player 위 오버레이에 부적합.
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={t('WidgetGuide.pause')}
                  title={t('WidgetGuide.pause')}
                  className="inline-flex shrink-0 items-center justify-center"
                  style={{ width: 24, height: 24 }}
                >
                  <PauseGlyph />
                </button>
              )}
              <span
                className="shrink-0 font-mono text-white"
                style={{ fontSize: 11 }}
              >
                {formatTime(current)}
              </span>
              {/* 트랙 — 클릭 시크. white/30 트랙 + amore 진행. */}
              <div
                role="slider"
                aria-label={t('WidgetGuide.seek')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                tabIndex={0}
                onClick={seekFromEvent}
                className="h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/30"
              >
                <div
                  className="h-full rounded-full bg-amore"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span
                className="shrink-0 font-mono text-white/70"
                style={{ fontSize: 11 }}
              >
                {totalLabel}
              </span>
            </div>
          </div>

          {/* Footer — paper-soft · 2px ink top border · blurb + (옵션) docs. */}
          <div
            className="flex shrink-0 items-center gap-3 border-t-2 border-ink bg-paper-soft"
            style={{ padding: '13px 20px' }}
          >
            <div
              className="text-mute"
              style={{ fontSize: 12.5, lineHeight: 1.5 }}
            >
              {t(guide.blurbKey)}
            </div>
            {guide.docsUrl && (
              <a
                href={guide.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-paper font-bold text-ink shadow-memphis-sm"
                style={{
                  border: '1.5px solid var(--canvas-card-border)',
                  padding: '7px 14px',
                  fontSize: 12,
                }}
              >
                {t('WidgetGuide.readDocs')}
              </a>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
