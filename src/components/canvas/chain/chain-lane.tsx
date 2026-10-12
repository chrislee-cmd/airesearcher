'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLane — 캔버스 맨 위의 체인 선반. CD SSOT: `v3/README.md` Geometry·L0~L9.

   체인은 **빈 선반으로 생성**되고 사용자가 카드 본체를 끌어넣어 조립한다
   (CD 결정 1·2·5). 레인은 이동하지 않는 고정 행이고, 본문이 화면보다 길어지면
   **레인 본문만** 가로로 스크롤된다 — 카드는 실치수 604×900 그대로다.

   경계: 프레젠테이션 + 콜백만. 레인 상태·도킹 판정·액션은 호스트가 소유한다.
   레인 chrome 은 **surface 레벨**이라 `[data-canvas-body]` cascade 밖이다
   (LEARNINGS §5 — 도킹 카드에 붙는 표시는 셸의 subbarEnd 슬롯만 쓴다).

   ── Soft Identity 적용 범위 (캔버스 모듈화 Phase 1 · 스펙 제약 1) ──────────
   이 PR 이 레인에서 하는 것은 **chrome 의 Soft 값 적용**뿐이다 — 색 · 선 ·
   그림자 · 서체. 치수(헤더 높이 · 패딩 · radius · font-size)는 **건드리지
   않는다**: 레인은 캔버스 transform 안에서 ~0.4 배로 보이는 표면이라 CD 컴프의
   절대 px 가 1:1 로 옮겨지지 않고, 스펙이 "레인 내부 구조/치수/상호작용 불변"
   을 명시한다. 그래서 1px 로 보여야 할 선은 3px 로 두되 **색만** Soft
   hairline(`--line`)으로 바꾼다 — 0.4 배에서 1.2px 로 읽힌다.
   외형 SSOT = `canvas-modular/full/README.md` §5 끝열 + 같은 번들의 레인 장면
   (v3 `.dc.html` 의 Memphis 값은 리브랜드 1단계 머지로 외형 권위를 잃었다 —
   soft-identity/WRITER-ANSWERS §5).
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

// 시그널 글자색 — Soft 는 배지/상태 문구를 `--{ok,run,warn,err}-fg` 로 쓴다.
const TONE_CLASS: Record<ChainLaneStatusTone, string> = {
  processing: 'text-soft-run-fg',
  amber: 'text-soft-warn-fg',
  error: 'text-soft-err-fg',
  success: 'text-soft-ok-fg',
  ink: 'text-ink',
  mute: 'text-soft-mute',
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
      className="inline-flex max-w-full flex-col overflow-hidden border-[3px] border-soft-line bg-soft-surface shadow-soft-card"
    >
      <header
        style={{ height: LANE_HEADER_H }}
        className="flex shrink-0 items-center gap-4 border-b-2 border-soft-hair bg-soft-surface px-6"
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-nav ${auto ? 'bg-ink' : 'bg-soft-fill'}`}
        >
          <DuotoneIcon name="link" size={20} mono={auto} />
        </span>
        <span
          style={{ fontFamily: 'var(--font-display)' }}
          className="shrink-0 text-3xl font-bold text-ink"
        >
          {title}
        </span>

        {modeEditable ? (
          <div
            role="radiogroup"
            aria-label={t('entry.modeGroup')}
            data-chain-el="mode-segment"
            className="inline-flex shrink-0 items-center gap-0 rounded-pill bg-soft-fill p-1"
          >
            <ModeCell
              selected={!auto}
              onClick={() => onModeChange('approve')}
            >
              {t('mode.approve')}
            </ModeCell>
            <ModeCell selected={auto} onClick={() => onModeChange('auto')}>
              {t('mode.auto')}
            </ModeCell>
          </div>
        ) : (
          <span
            data-chain-el="mode-badge"
            className={`inline-flex shrink-0 items-center rounded-pill px-3 py-1 text-lg font-semibold ${
              auto ? 'bg-ink text-soft-surface' : 'bg-soft-fill text-soft-ink-2'
            }`}
          >
            {t(auto ? 'mode.auto' : 'mode.approve')}
          </span>
        )}

        <span aria-hidden className="h-[30px] w-px shrink-0 bg-soft-line" />
        <span
          role="status"
          data-chain-el="status"
          className={`shrink-0 font-soft-mono text-2xl font-semibold ${TONE_CLASS[statusTone]}`}
        >
          {statusText}
        </span>

        <span className="flex-1" />

        {lockNote && (
          <span
            data-chain-el="lock-note"
            className="shrink-0 text-lg text-soft-mute"
          >
            {lockNote}
          </span>
        )}
        {costNote && (
          <span
            data-chain-el="cost"
            className="inline-flex shrink-0 items-center rounded-pill bg-soft-fill px-3 py-1 font-soft-mono text-lg font-semibold text-soft-ink-2"
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
            className="shrink-0 text-2xl font-semibold text-soft-mute transition-colors hover:text-ink"
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
      className={`rounded-pill px-4 py-2 text-xl font-semibold transition-colors ${
        selected
          ? 'bg-soft-surface text-ink shadow-soft-chip'
          : 'text-soft-mute hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
