'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Shared <Button> primitive — codifies the inline patterns scattered across
// the app (177 native <button> JSX sites observed in 2026-05-31 audit).
//
// Variants:
//   primary / secondary / ghost / destructive  — pill-shape actions
//   link / destructive-link                    — text-only inline actions
// Sizes:
//   xs / sm / md / lg / cta                    — all pill (핵심규칙 5)
//
// **Soft Identity 리브랜드 1단계** — 공유 셸 4계층이 전부 이 primitive 를 쓰므로
// 버튼 체계도 1단계에 포함된다(의뢰 "버튼 pill 체계"). CD 변환표·핵심규칙:
//   · 핵심규칙 5 "버튼은 전부 pill" — 주 버튼 ink 채움 + 흰 글자(테두리·그림자
//     없음) · 보조 버튼 흰 면 + 1px --line · 파괴는 --danger.
//   · 핵심규칙 1/2 — 1.5/2/2.5/3px 보더와 하드 오프셋 그림자는 전부 없앤다.
//     따라서 Memphis hover translate-lift 도 사라지고, hover 는 색만 바뀐다
//     (주 버튼 bg #2e2b33 = --ink 보다 한 단계 밝은 톤, 보조 버튼 border
//     --faint, 전환 120ms ease-out).
// 치수(padding·font-size·hit area)는 불변 — radius 와 색/선/그림자만 교체.

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'link'
  | 'destructive-link'
  | 'subtle';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'cta';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  // 슈퍼어드민 DS 인스펙터용 primitive 이름(카탈로그 label). 기본 'Button'.
  // Button 을 자기 chrome 으로 재사용하는 상위 primitive(DownloadMenu/ShareMenu)가
  // 자기 이름으로 덮어써 인스펙터에 정확한 primitive 를 노출한다.
  dsPrimitive?: string;
};

// transition-colors — Soft 에서 hover 는 색만 바뀐다(translate/shadow morph 가
// 사라졌으므로 transition-all 이 필요 없다). disabled:{transform-none,
// shadow-none} 은 press scale 을 중립화해 opacity-40 read 가 평평하게 남는다.
const BASE =
  'inline-flex items-center justify-center gap-1.5 border font-semibold ' +
  // duration 은 모션 토큰(--dur-fast = 120ms) SSOT 참조 — CD "전환 120ms
  // ease-out" 과 동일값.
  'transition-colors duration-[var(--dur-fast)] ' +
  // press 피드백은 scale 만 남긴다(Memphis translate-lift 는 하드 그림자와 짝
  // 이었으므로 함께 제거). reduced-motion 시 중립.
  'active:scale-[0.97] motion-reduce:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-40 ' +
  'disabled:transform-none disabled:shadow-none ' +
  // focus-visible = border ink + --focus-ring (하드 그림자로 포커스를 표시하지
  // 않는다 — CD Interactions).
  'focus:outline-none focus-visible:border-ink focus-visible:shadow-soft-focus-ring';

// Soft tone — 1px 선 또는 선 없는 채움, 그림자 0, hover 는 색만.
// link/destructive-link stay flat (text-only identity).
const VARIANT: Record<ButtonVariant, string> = {
  // 주 버튼 — ink 채움 + 흰 글자 · 테두리·그림자 없음 · hover 는 한 단계 밝게.
  primary:
    'border-transparent bg-ink text-soft-surface shadow-none ' +
    'hover:bg-soft-ink-hover',
  // 보조 버튼 — 흰 면 + 1px --line · hover 는 border 만 진하게.
  secondary:
    'border-soft-line bg-soft-surface text-ink shadow-none ' +
    'hover:border-soft-line-hover hover:bg-soft-surface-2',
  // 3차(ghost) — 보조보다 약한 중립 면. 선 없음 + --fill.
  ghost:
    'border-transparent bg-soft-fill text-soft-ink-2 shadow-none ' +
    'hover:bg-soft-line',
  // 파괴 — 흰 면 + 1px --line · 글자/보더가 hover 에서 --danger 로.
  destructive:
    'border-soft-line bg-soft-surface text-soft-danger shadow-none ' +
    'hover:border-soft-danger hover:bg-soft-err-bg',
  // Text-only neutral action (e.g. "switch to sign up", inline cancels).
  link:
    'border-transparent bg-transparent text-soft-mute hover:text-ink ' +
    'underline decoration-1 underline-offset-4 decoration-transparent hover:decoration-ink',
  // Text-only delete action (8 sites: row deletes, panel removes) —
  // 변환표 "목록의 파괴 액션은 --danger 텍스트 버튼".
  'destructive-link':
    'border-transparent bg-transparent text-soft-mute hover:text-soft-danger ' +
    'underline decoration-1 underline-offset-4 decoration-transparent hover:decoration-soft-danger',
  // Subtle tone for header bands — 중립 칩(--fill). 셸의 세그먼트 트랙과 같은
  // 면색이라 헤더가 한 가족으로 읽힌다.
  subtle:
    'border-transparent bg-soft-fill text-soft-ink-2 shadow-none ' +
    'hover:bg-soft-line',
};

// SIZE owns padding/font/radius only. 패딩·폰트는 불변(치수 무변경) — radius
// 만 전부 pill 로(핵심규칙 5 "버튼은 전부 pill").
const SIZE: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1 text-xs-soft rounded-pill',
  sm: 'px-4 py-1.5 text-sm rounded-pill',
  md: 'px-5 py-2 text-md rounded-pill',
  lg: 'px-5 py-2.5 text-lg rounded-pill',
  cta: 'px-4 py-3 text-sm uppercase tracking-[0.22em] rounded-pill',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'sm',
    loading = false,
    loadingLabel,
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    type = 'button',
    dsPrimitive = 'Button',
    ...rest
  },
  ref,
) {
  const cls = [
    BASE,
    VARIANT[variant],
    SIZE[size],
    fullWidth ? 'w-full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    // data-canvas-action: globals.css 의 [data-canvas-body] button cascade
    // (background:#fff · color:#000 · border 2.5px) 에서 opt-out.
    // 위 cascade 는 attribute selector specificity (0,2,1) 가 Tailwind utility
    // (0,1,0) 를 이겨 variant primary 의 bg-ink 까지 흰색으로 덮어쓰는 회귀가
    // 있어, canvas widget 안 region/preset toggle 의 선택 시각이 사라졌습니다.
    // Button primitive 는 자체 chrome 을 가지므로 항상 opt-out 이 맞음
    // (IconButton 과 동일 패턴). canvas 외부에서는 cascade 자체가 적용 안 돼
    // 부작용 0.
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cls}
      data-canvas-action
      {...rest}
      // 인스펙터 태그는 {...rest} 뒤 — consumer 가 실수로 덮지 못하게 항상 존재.
      data-ds-primitive={dsPrimitive}
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  );
});
