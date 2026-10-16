'use client';

/* ────────────────────────────────────────────────────────────────────
   ChainStepCard — 레인 안의 **240×300 읽기 전용 요약 카드** (fresh 프레젠테이션).

   비주얼 SSOT = `design-handoff/chain-inspector/chain-inspector-scenes.dc.html`
   **I1 갤러리 5칸**(unset · ready · running · done · noconfig) + I0/I2/I3/I3b 의
   레인 안 카드. 치수·구조 SSOT = 같은 번들 `README.md` §1.1~§1.5.

   **왜 fresh 인가** (스펙 "참조 구현 우선" 의 예외 쪽): 레인·세그먼트·팔레트는
   기존 구현이 SSOT 라 재사용하지만, 이 카드와 인스펙터는 CD 가 새로 그린
   표면이다. 옛 셋업 UI(`probing/setup-accordion` · `transcript-setup-accordion`
   · `interviews-card` 의 셋업부)는 **폭 604 전제**라 240 에 맞지 않고, CD 가
   Q5 에서 "새로 그린다" 로 판정했다 — 이식하지 않는다.

   **카드 안에 입력·토글·실행 버튼이 0개**인 것이 이 PR 의 핵심이다(사용자
   지시). 카드 전체가 `role="button"` 이고, 별도 타깃은 "설정하기"(인스펙터
   열기)와 "결과 보기 ↗"(기존 풀뷰) **둘뿐**이다(§1.5). "편집"/"입력 보기" 는
   라벨이고 타깃이 아니다 — 그래서 `<span>` 으로 그린다.

   데이터 0 — `card-state.ts` 가 만든 표시 모델과 콜백만 받는다. 상태 어휘·
   파생 규칙을 여기서 재계산하지 않는다(카드와 인스펙터 하단이 갈라지는 입구).

   **cascade 밖이다**: 이 카드는 레인 본문의 흐름 요소이고 `widget-shell` 의
   바디 래퍼(`[data-canvas-body]`) 안이 아니다 — `.text-xl` 함정·native button
   cascade 를 겪지 않는다(LEARNINGS §5 의 스코프 경계).
   ──────────────────────────────────────────────────────────────────── */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { widgetIconFor } from '@/components/canvas/shell/widget-icon';
import type { ChainCardModel, ChainCardSignal } from '@/lib/chains/card-state';

/** 레인 안 카드 실치수 — CD §1.1 "240 × 300 고정". */
export const CARD_W = 240;
export const CARD_H = 300;

/** 시그널 배지 — 면 + 글자 + 점. 테두리 없음(Soft 핵심규칙 4). */
const SIGNAL: Record<ChainCardSignal, { bg: string; fg: string; dot: string }> = {
  ok: { bg: 'bg-soft-ok-bg', fg: 'text-soft-ok-fg', dot: 'bg-soft-ok-dot' },
  run: { bg: 'bg-soft-run-bg', fg: 'text-soft-run-fg', dot: 'bg-soft-run-dot' },
  warn: { bg: 'bg-soft-warn-bg', fg: 'text-soft-warn-fg', dot: 'bg-soft-warn-dot' },
  err: { bg: 'bg-soft-err-bg', fg: 'text-soft-err-fg', dot: 'bg-soft-err-dot' },
  idle: { bg: 'bg-soft-fill', fg: 'text-soft-ink-2', dot: 'bg-soft-faint' },
};

/** 아이콘 타일 면 = 위젯 **원색**(작은 면 — Soft 핵심규칙 3). */
const TONE_BG: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'bg-sky',
  lav: 'bg-lav',
  rose: 'bg-rose',
};

/** 선택 halo 의 톤 — 2px ink 링 바깥의 6px 위젯 톤(§1.3 "선택됨"). */
const TONE_VAR: Record<'sky' | 'lav' | 'rose', string> = {
  sky: 'var(--tone-sky)',
  lav: 'var(--tone-lav)',
  rose: 'var(--tone-rose)',
};

export type ChainStepCardProps = {
  model: ChainCardModel;
  /** 헤더 아이콘·이름 — 그 단계를 맡은 위젯의 것. */
  widgetKey: string;
  name: string;
  tone: 'sky' | 'lav' | 'rose';
  /** 인스펙터가 이 카드를 편집 중인가 — 선택 링 + "편집 중" pill. */
  selected: boolean;
  /** "편집 중" pill 문구(로케일). */
  selectedLabel: string;
  /** 카드 전체 히트 영역 — 인스펙터 열기/닫기 토글. */
  onOpen: () => void;
  /** "결과 보기 ↗" — 기존 풀뷰. */
  onOpenResult: () => void;
  /** 접근성 레이블("체인 1 · 3단계 인터뷰 결과 생성기"). */
  ariaLabel: string;
  /**
   * P1b "행을 누른 뒤" 링 — 팔레트에서 레인 카드 위치를 누르면 그 카드로 팬한
   * 뒤 1.2s 링이 떴다 사라진다. 링은 **레인 안 카드 노드**에 붙는다(그리드
   * 래퍼가 아니다 — LEARNINGS §8-3).
   */
  ring?: boolean;
  /**
   * 카드에서 난 키 입력 중 **카드가 쓰지 않는 것**을 호스트로 넘긴다
   * (언도킹 Delete/Backspace 경로 — 보드가 소유).
   */
  onCardKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void;
};

export function ChainStepCard({
  model,
  widgetKey,
  name,
  tone,
  selected,
  selectedLabel,
  onOpen,
  onOpenResult,
  ariaLabel,
  ring = false,
  onCardKeyDown,
}: ChainStepCardProps) {
  const unset = model.layout === 'unset';
  const sig = SIGNAL[model.badge.tone];

  return (
    <div
      data-chain="step-card"
      data-chain-card={model.layout}
      data-chain-card-step={widgetKey}
      data-chain-card-selected={selected ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onOpen}
      onKeyDown={(e) => {
        // CD §10 Done-when — 카드 Enter/Space 로 인스펙터를 연다.
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
          return;
        }
        onCardKeyDown?.(e);
      }}
      style={{
        width: CARD_W,
        height: CARD_H,
        // 선택 링은 **이 카드 노드**에 준다 — 감싸는 자리(dock 슬롯)에 주면
        // 레인 안에서 한 칸 밀려 그려진다(CD §9 · LEARNINGS §8-3).
        boxShadow: selected
          ? `0 0 0 2px var(--ink), 0 0 0 6px ${TONE_VAR[tone]}`
          : undefined,
        // P1b 링의 톤 주입(`.palette-ring` keyframe 이 이 변수를 읽는다).
        ...(ring ? ({ '--palette-ring-tone': TONE_VAR[tone] } as React.CSSProperties) : null),
      }}
      className={`flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-sm text-left focus:outline-none ${
        unset
          ? 'border-[1.5px] border-dashed border-soft-disabled bg-soft-surface-2'
          : `border border-soft-line bg-soft-surface ${selected ? '' : 'shadow-soft-card'}`
      } ${selected ? '' : 'focus-visible:shadow-soft-focus-ring'} ${ring ? 'palette-ring' : ''}`}
    >
      {/* 헤더 — 톤 타일 30 + 이름 + 단계 mono (+ 선택 pill) */}
      <div className="flex shrink-0 items-center gap-2.5 px-3.5 pt-3.5">
        <span
          aria-hidden
          style={{ width: 30, height: 30 }}
          className={`flex shrink-0 items-center justify-center rounded-nav ${TONE_BG[tone]}`}
        >
          <DuotoneIcon name={widgetIconFor(widgetKey)} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-lg font-bold text-ink">{name}</span>
          <span className="font-soft-mono text-xs-soft text-soft-faint">
            {model.stepText}
          </span>
        </span>
        {selected && (
          <span className="shrink-0 rounded-pill bg-ink px-2 py-0.5 text-xs-soft font-semibold whitespace-nowrap text-soft-surface">
            {selectedLabel}
          </span>
        )}
      </div>

      {/* 상태 배지 */}
      <div className="flex shrink-0 px-3.5 pt-2.5">
        <span
          data-chain-el="card-badge"
          className={`inline-flex items-center gap-[5px] rounded-pill px-[9px] py-0.5 text-sm font-semibold whitespace-nowrap ${sig.bg} ${sig.fg}`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${sig.dot} ${
              model.badge.pulse ? 'animate-sipulse' : ''
            }`}
          />
          {model.badge.label}
        </span>
      </div>

      {/* 본문 — 최대 3행 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 py-3">
        {model.progress !== null && (
          <div className="flex shrink-0 flex-col gap-1.5">
            <div
              role="progressbar"
              aria-valuenow={Math.round(model.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 overflow-hidden rounded-2xs bg-soft-run-track"
            >
              <div
                className="h-full bg-soft-run-dot"
                style={{ width: `${Math.max(0, Math.min(100, model.progress))}%` }}
              />
            </div>
            {model.runText && (
              <span className="truncate text-md text-soft-ink-2">{model.runText}</span>
            )}
          </div>
        )}

        {model.needText && (
          <div className="flex shrink-0 flex-col gap-2">
            <span className="text-md font-semibold text-soft-ink-2">
              {model.needText}
            </span>
            {model.needs.map((need) => (
              <span
                key={need}
                className="flex items-center gap-2 text-md text-soft-mute"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-soft-disabled"
                />
                {need}
              </span>
            ))}
          </div>
        )}

        {model.rows.map((row) => (
          <span
            key={row.id}
            className={`flex flex-col gap-0.5 ${model.dimRows ? 'opacity-55' : ''}`}
          >
            <span className="text-xs-soft text-soft-faint">{row.label}</span>
            <span className="truncate text-lg font-semibold text-ink">
              {row.value ?? '—'}
            </span>
          </span>
        ))}

        {model.moreText && (
          <span className="text-sm text-soft-mute">{model.moreText}</span>
        )}
      </div>

      {/* 푸터 44 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-soft-hair px-3.5">
        <span className="font-soft-mono text-sm whitespace-nowrap text-soft-mute">
          {model.footLeft}
        </span>
        <span className="flex-1" />
        {model.action?.kind === 'primary' && (
          // eslint-disable-next-line react/forbid-elements -- CD §1.3 unset 푸터의 "설정하기" 는 높이 28 · px 12 · ink 채움 · 12/600 전용 chrome 이다. Button primitive 의 size 는 패딩 파생 높이라 28 이 안 나오고 className 으로 되돌리면 §7.11(컴파일 CSS 소스 순서)에서 불확정. 레인 헤더·캡슐의 같은 선례를 따른다.
          <button
            type="button"
            data-chain-action="configure"
            onClick={(e) => {
              // 카드 전체와 같은 동작이지만 **별도 타깃**이다(§1.5) — 중복
              // 호출을 막기 위해 버블을 끊는다.
              e.stopPropagation();
              onOpen();
            }}
            className="inline-flex h-7 shrink-0 items-center rounded-pill bg-ink px-3 text-md font-semibold whitespace-nowrap text-soft-surface transition-colors hover:bg-soft-ink-hover"
          >
            {model.action.label}
          </button>
        )}
        {model.action?.kind === 'link' && (
          // eslint-disable-next-line react/forbid-elements -- CD §1.3 done 푸터의 "결과 보기 ↗" 는 패딩·보더·밑줄 없는 bare 텍스트(12/600 ink)다. Button variant="link" 는 size padding + hover 밑줄 + mute 색을 강제한다(§7.11 로 되돌리기 불확정). 레인 헤더 액션과 동일 선례.
          <button
            type="button"
            data-chain-action="open-result"
            onClick={(e) => {
              e.stopPropagation();
              onOpenResult();
            }}
            className="shrink-0 text-md font-semibold whitespace-nowrap text-ink transition-colors hover:text-soft-mute"
          >
            {model.action.label}
          </button>
        )}
        {model.action?.kind === 'text' && (
          // "편집" / "입력 보기" — **별도 타깃이 아니다**(§1.5). 카드 전체가
          // 그 동작을 가지므로 라벨만 그린다.
          <span className="shrink-0 text-md whitespace-nowrap text-soft-mute">
            {model.action.label}
          </span>
        )}
      </div>
    </div>
  );
}
