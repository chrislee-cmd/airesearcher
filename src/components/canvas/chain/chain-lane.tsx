'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainLane — 캔버스 맨 위의 체인 선반. CD SSOT: `v3/README.md` Geometry·L0~L9.

   체인은 **빈 선반으로 생성**되고 사용자가 카드 본체를 끌어넣어 조립한다
   (CD 결정 1·2·5). 레인은 이동하지 않는 고정 행이고, 본문이 화면보다 길어지면
   **레인 본문만** 가로로 스크롤된다 — 카드는 실치수 240×300 그대로다.

   경계: 프레젠테이션 + 콜백만. 레인 상태·도킹 판정·액션은 호스트가 소유한다.
   레인 chrome 은 **surface 레벨**이라 `[data-canvas-body]` cascade 밖이다
   (LEARNINGS §5 — 도킹 카드에 붙는 표시는 셸의 subbarEnd 슬롯만 쓴다).

   ── 치수 재환산 (체인 인스펙터 §2) ─────────────────────────────────────
   리브랜드 1단계 시점의 레인 치수(헤더 72 · 제목 22 · 상태 18 · 본문 패딩
   32/40)는 **줌 0.3–0.45 전제의 캔버스 값**이었다. 카드가 604×900 → 240×300
   으로 줄어 **줌 100% 가 기본**이 되면서 그 값들이 화면에 그대로 보이게 됐고,
   CD 가 전부 재환산했다(chain-inspector/README §2 표 + `.dc.html` I0):

     헤더 72 → **52** · 제목 22 → **15** · 상태 18 → **12** · 링크 타일 40 → **28**
     본문 패딩 32/40 → **28/24** · 컨테이너 radius → **16**(`--r-card` =
     "lane container", soft-identity tokens.css)

   `.dc.html` 이 BUILD-SPEC 프로즈보다 외형에서 우선한다(규칙 2c).

   ── 헤더 sticky-left (§2) ──────────────────────────────────────────────
   레인을 팬해 헤더 왼쪽이 화면 밖으로 나가면 헤더 **내용**이 보이는 창의 왼쪽
   끝에 붙어 따라온다. 레인 폭(1168)이 창보다 넓어질 수 있어서 "지금 어느
   체인인가" 가 사라지면 안 된다.

   ⚠️ **CSS `position: sticky` 로는 안 된다.** 여기서 "팬" 은 레인 본문 스크롤이
   아니라 **캔버스 transform** 이다(레인 전체가 `translate3d(pan) scale(zoom)`
   안에 있다). sticky 는 조상의 transform 을 모르므로 아무 일도 하지 않는다 —
   그래서 보드가 pan·zoom 에서 **캔버스 좌표계 오프셋**을 계산해 `headerOffset`
   으로 내려주고, 헤더 내용이 그만큼 translate 된다. 계산은 보드의 렌더 중
   순수식이다(DOM 읽기·effect 0).

   ── 좁은 화면 축약 (§6) ────────────────────────────────────────────────
   900–1023 에서 인스펙터가 열리면 **모드 세그먼트와 툴바 안내 문구를 숨긴다**
   (`narrow`). 인스펙터를 닫으면 다시 보인다.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';

export const LANE_HEADER_H = 52;

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

// 상태 점 색 — 글자색과 같은 시그널 계열의 dot 원자(§2 "mono 700 + 점 6").
const DOT_CLASS: Record<ChainLaneStatusTone, string> = {
  processing: 'bg-soft-run-dot',
  amber: 'bg-soft-warn-dot',
  error: 'bg-soft-err-dot',
  success: 'bg-soft-ok-dot',
  ink: 'bg-soft-faint',
  mute: 'bg-soft-faint',
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
  /** §6 900–1023 — 모드 세그먼트·안내 문구를 숨긴다. */
  narrow?: boolean;
  /**
   * sticky-left 오프셋(**캔버스 px**). 레인 왼쪽이 보이는 창 밖으로 밀려난
   * 만큼이고, 0 이면 평소 위치다. 위 주석의 이유로 CSS sticky 가 아니다.
   */
  headerOffset?: number;
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
  narrow = false,
  headerOffset = 0,
}: ChainLaneProps) {
  const t = useTranslations('Chain');
  const auto = mode === 'auto';

  return (
    <section
      data-chain="lane"
      data-chain-mode={mode}
      aria-label={title}
      className="inline-flex max-w-full flex-col overflow-hidden rounded-panel-lg border border-soft-line bg-soft-surface shadow-soft-card"
    >
      <header
        style={{ height: LANE_HEADER_H }}
        className="flex shrink-0 items-center gap-3 border-b border-soft-hair bg-soft-surface px-[18px]"
      >
        {/* sticky-left — 레인 본문이 창보다 넓어 팬으로 왼쪽이 밀려나도 헤더
            내용은 보이는 창의 왼쪽 끝에 붙어 따라온다(§2). 헤더 자체가 아니라
            **내용 묶음**이 sticky 다: 헤더는 레인 폭 전체를 차지해야 아래
            테두리가 끊기지 않는다. */}
        <span
          data-chain-el="header-inner"
          data-chain-sticky={headerOffset > 0 ? 'true' : 'false'}
          // 계산값을 DOM 에 노출한다 — sticky 는 **파생값이 DOM 과 어긋나면
          // 조용히 안 움직이는** 종류라(실측: 팬 직후 오프셋이 0 으로 남았다)
          // conformance 하네스가 기대 오프셋과 실제 레인 위치를 기계로 대조할
          // 수 있어야 한다.
          data-chain-header-offset={Math.round(headerOffset)}
          style={
            headerOffset > 0
              ? { transform: `translateX(${headerOffset}px)` }
              : undefined
          }
          className="flex min-w-0 items-center gap-3 bg-soft-surface whitespace-nowrap"
        >
        <span
          style={{ width: 28, height: 28 }}
          className={`flex shrink-0 items-center justify-center rounded-nav ${auto ? 'bg-ink' : 'bg-soft-fill'}`}
        >
          <DuotoneIcon name="link" size={16} mono={auto} />
        </span>
        <span
          style={{ fontFamily: 'var(--font-display)' }}
          className="shrink-0 text-xl font-bold text-ink"
        >
          {title}
        </span>

        {modeEditable && !narrow ? (
          <div
            role="radiogroup"
            aria-label={t('entry.modeGroup')}
            data-chain-el="mode-segment"
            className="inline-flex shrink-0 items-center gap-0 rounded-pill bg-soft-fill p-0.5"
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
        ) : narrow ? null : (
          <span
            data-chain-el="mode-badge"
            className={`inline-flex shrink-0 items-center rounded-pill px-[11px] py-1 text-sm font-semibold ${
              auto ? 'bg-ink text-soft-surface' : 'bg-soft-fill text-soft-ink-2'
            }`}
          >
            {t(auto ? 'mode.auto' : 'mode.approve')}
          </span>
        )}

        {/* 상태 문구 — mono 12/700 + 점 6 (§2 표). 점이 생겨 세로 구분선은
            필요가 없어졌다(컴프 I0 에도 없다). */}
        <span
          role="status"
          data-chain-el="status"
          className={`inline-flex shrink-0 items-center gap-1.5 font-soft-mono text-md font-bold ${TONE_CLASS[statusTone]}`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[statusTone]}`}
          />
          {statusText}
        </span>
        </span>

        <span className="flex-1" />

        {lockNote && !narrow && (
          <span
            data-chain-el="lock-note"
            className="shrink-0 text-sm whitespace-nowrap text-soft-mute"
          >
            {lockNote}
          </span>
        )}
        {costNote && !narrow && (
          <span
            data-chain-el="cost"
            className="inline-flex shrink-0 items-center rounded-pill bg-soft-fill px-[11px] py-1 font-soft-mono text-sm font-semibold whitespace-nowrap text-soft-ink-2"
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
            className="shrink-0 text-md font-semibold whitespace-nowrap text-soft-mute transition-colors hover:text-ink"
          >
            {action.label}
          </button>
        )}
      </header>

      {/* 본문 — 레인만 가로 스크롤(CD 결정 1). 패딩 28/24 (§2 표). */}
      <div
        ref={bodyRef}
        data-chain-el="lane-body"
        onScroll={onBodyScroll}
        className="flex items-center gap-0 overflow-x-auto overflow-y-hidden px-6 py-7"
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
      className={`rounded-pill px-[11px] py-1 text-sm font-semibold transition-colors ${
        selected
          ? 'bg-soft-surface text-ink shadow-soft-chip'
          : 'text-soft-mute hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
