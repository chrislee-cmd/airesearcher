'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLane — 캔버스 맨 위의 체인 선반. CD SSOT: `v3/README.md` Geometry·L0~L9.

   체인은 **빈 선반으로 생성**되고 사용자가 카드 본체를 끌어넣어 조립한다
   (CD 결정 1·2·5). 레인은 이동하지 않는 고정 행이고, 본문이 화면보다 길어지면
   **레인 본문만** 가로로 스크롤된다 — 카드는 실치수 604×900 그대로다.

   경계: 프레젠테이션 + 콜백만. 레인 상태·도킹 판정·액션은 호스트가 소유한다.
   레인 chrome 은 **surface 레벨**이라 `[data-canvas-body]` cascade 밖이다
   (LEARNINGS §5 — 도킹 카드에 붙는 표시는 셸의 subbarEnd 슬롯만 쓴다).
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';

export const LANE_HEADER_H = 72;

export type ChainLaneStatusTone =
  | 'processing'
  | 'amber'
  | 'error'
  | 'success'
  | 'ink'
  | 'mute';

const TONE_CLASS: Record<ChainLaneStatusTone, string> = {
  processing: 'text-lav-text',
  amber: 'text-amber-text',
  error: 'text-error-text',
  success: 'text-success-text',
  ink: 'text-ink',
  mute: 'text-mute',
};

export type ChainLaneProps = {
  title: string;
  /** 조립 중 = 세그먼트(편집 가능) · 실행 후 = 배지(고정). */
  mode: 'approve' | 'auto';
  modeEditable: boolean;
  onModeChange: (mode: 'approve' | 'auto') => void;
  statusText: string;
  statusTone: ChainLaneStatusTone;
  /** 실행 중 구성 잠금 문구. null 이면 미표시. */
  lockNote?: string | null;
  /** "세션 후 💎1 + 파일당 25" 칩. null 이면 미표시. */
  costNote?: string | null;
  /** 우측 텍스트 액션 — 조립 중 "해체" / 실행 중 "체인 종료". */
  action?: { label: string; onClick: () => void } | null;
  /** 레인 본문(카드·슬롯·세그먼트·산출물 노드). */
  children: ReactNode;
  /** 드래그 중 좌표 판정을 위해 호스트가 잡는 본문 ref. */
  bodyRef?: React.Ref<HTMLDivElement>;
  onBodyScroll?: () => void;
};

export function ChainLane({
  title,
  mode,
  modeEditable,
  onModeChange,
  statusText,
  statusTone,
  lockNote,
  costNote,
  action,
  children,
  bodyRef,
  onBodyScroll,
}: ChainLaneProps) {
  const t = useTranslations('Chain');
  const auto = mode === 'auto';

  return (
    <section
      data-chain="lane"
      data-chain-mode={mode}
      aria-label={title}
      style={{ borderRadius: 'var(--widget-card-frame-radius)' }}
      className="inline-flex max-w-full flex-col overflow-hidden border-[3px] border-ink bg-paper-soft shadow-memphis-md-faint"
    >
      <header
        style={{ height: LANE_HEADER_H }}
        className="flex shrink-0 items-center gap-4 border-b-2 border-ink bg-paper px-6"
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card border-2 border-ink ${auto ? 'bg-ink' : 'bg-paper'}`}
        >
          <DuotoneIcon name="link" size={20} mono={auto} />
        </span>
        <span
          style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
          className="shrink-0 text-3xl font-extrabold text-ink"
        >
          {title}
        </span>

        {modeEditable ? (
          <div
            role="radiogroup"
            aria-label={t('entry.modeGroup')}
            data-chain-el="mode-segment"
            className="inline-flex shrink-0 overflow-hidden rounded-control border-2 border-ink bg-paper shadow-memphis-sm"
          >
            <ModeCell
              selected={!auto}
              onClick={() => onModeChange('approve')}
            >
              {t('mode.approve')}
            </ModeCell>
            <span aria-hidden className="w-0.5 bg-ink" />
            <ModeCell selected={auto} onClick={() => onModeChange('auto')}>
              {t('mode.auto')}
            </ModeCell>
          </div>
        ) : (
          <span
            data-chain-el="mode-badge"
            className={`inline-flex shrink-0 items-center rounded-pill border-2 border-ink px-3 py-1 text-lg font-extrabold ${
              auto ? 'bg-ink text-paper' : 'bg-paper text-ink'
            }`}
          >
            {t(auto ? 'mode.auto' : 'mode.approve')}
          </span>
        )}

        <span aria-hidden className="h-[30px] w-0.5 shrink-0 bg-ink/[0.14]" />
        <span
          role="status"
          data-chain-el="status"
          className={`shrink-0 font-mono text-2xl font-extrabold ${TONE_CLASS[statusTone]}`}
        >
          {statusText}
        </span>

        <span className="flex-1" />

        {lockNote && (
          <span
            data-chain-el="lock-note"
            className="shrink-0 text-lg text-mute"
          >
            {lockNote}
          </span>
        )}
        {costNote && (
          <span
            data-chain-el="cost"
            className="inline-flex shrink-0 items-center rounded-pill border-2 border-ink bg-paper px-3 py-1 font-mono text-lg font-extrabold text-ink"
          >
            {costNote}
          </span>
        )}
        {action && (
          // eslint-disable-next-line react/forbid-elements -- CD 레인 헤더의 액션("해체"/"체인 종료")은 패딩·보더 없는 bare 텍스트다. Button variant="link" 는 size padding + hover 밑줄을 강제하고 className 되돌리기는 §7.11(컴파일 CSS 소스 순서) 때문에 불확정. v2 캡슐 "체인 종료" 와 동일 선례.
          <button
            type="button"
            data-chain-action="lane"
            onClick={action.onClick}
            className="shrink-0 text-2xl font-bold text-mute transition-colors hover:text-ink"
          >
            {action.label}
          </button>
        )}
      </header>

      {/* 본문 — 레인만 가로 스크롤(CD 결정 1). 캔버스 줌과 중첩되므로 검증 항목. */}
      <div
        ref={bodyRef}
        data-chain-el="lane-body"
        onScroll={onBodyScroll}
        className="flex items-center gap-0 overflow-x-auto overflow-y-hidden px-8 py-10"
      >
        {children}
      </div>
    </section>
  );
}

function ModeCell({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- 세그먼트 셀은 트랙이 chrome 을 소유하는 bare 셀이다. Button primitive 는 셀마다 자기 chrome 을 그려 세그먼트가 성립하지 않는다(picker-trigger grouped 셀과 같은 구조).
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`px-4 py-2 text-xl font-extrabold transition-colors ${
        selected ? 'bg-ink text-paper' : 'bg-paper text-mute hover:bg-paper-soft'
      }`}
    >
      {children}
    </button>
  );
}
