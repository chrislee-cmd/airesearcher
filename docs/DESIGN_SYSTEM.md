# Design System — Comprehensive SSOT

> **이 문서는 디자인 시스템의 단일 진실 소스 (SSOT) 입니다.**
> 새 톤 swap · 새 primitive 추가 · 컴포넌트 토큰 매핑 · 모든 hardcoded 색 audit 가
> 한 곳에 모입니다. design-system.md (옷장 비유) + PROJECT.md §9 의 짧은 요약을
> 보강 / 대체합니다.

작성: 2026-06-28 · PR: design-system-comprehensive-ssot

---

## 0. 한 줄 요약

**`<html data-theme="<X>">` 한 줄 변경 = 앱 전체 톤 swap.**

지금까지 분산된 D-buttons / D-paper-token / D-sidebar / D-canvas / D-loading 등
디자인 PR 을 일일이 추적할 필요 없이, **Layer 1 (Raw) 의 새 `[data-theme]`
블록 하나** 만 추가하면 semantic + component layer 가 자동 cascade.

---

## 0.5 이 문서는 어떻게 갱신되나 (inbox 패턴)

**원칙**: 이 SSOT 문서는 코드가 바뀔 때마다 같이 바뀌어야 한다. 안 챙기면
"라벨이 실제 옷장과 다른" 상태 (stale) 가 되고, 미래 합류자가 잘못된 가정
하에 작업한다 (중복 primitive 생성 / 새 톤 swap 시 raw 키 누락 등).

**갱신 메커니즘**: `docs/DESIGN_SYSTEM_PENDING.md` inbox.
PROJECT.md §5.4 의 `docs/PROJECT_PENDING.md` 와 동일 패턴.

```
PR 머지 → self-check → DESIGN_SYSTEM 갱신감? → 인박스에 한 줄 append
                                        ↓
                              5건 누적 또는 시급 트리거
                                        ↓
                       묶음 PR 로 DESIGN_SYSTEM.md 갱신
```

**self-check 트리거** (이 중 하나라도 해당 → 인박스 한 줄):
| 트리거 | 갱신 위치 |
|---|---|
| 새 primitive 추가 (`src/components/ui/` 안 새 파일) | §3 Primitive 카탈로그 |
| 새 raw 토큰 키 추가 (`--raw-*`) | §1.2 + 모든 `[data-theme]` 동기화 |
| 새 semantic / component 토큰 | §1.3 / §1.4 |
| 새 톤 추가 (`[data-theme="<new>"]`) | §2 등록 theme |
| Hardcoded hex sweep PR 머지 | §4.2 카운트 |
| primitive variant / size 변경 | §3 해당 항목 |
| 톤 swap 시 알게 된 함정 / 회귀 | §5.3 디버그 표 |

자세한 룰·기록 포맷은 `docs/DESIGN_SYSTEM_PENDING.md` 상단 참고.

> **왜 codegen 이 아니라 inbox 인가**: 카탈로그 중 자동 추출 가능한 부분 (variant/size, hex 카운트) 은 30% 정도. 컨셉·의도·함정·왜 (Memphis 톤 / 옷장 비유 / 회귀 패턴) 는 사람이 써야 함. codegen 도구의 유지보수 부담 + 잘못된 자동 정보 위험까지 감안하면 ROI 가 inbox 대비 1.5배 효과 / 20~30배 작업. 카탈로그가 50+ primitive 로 커지면 그때 codegen 재검토.

---

## 1. 토큰 계층 (3-layer)

### 1.1 왜 3-layer 인가

이전 구조는 **flat** — `--canvas-bg`, `--sidebar-bg`, `--color-paper` 가 모두
hex 직접 값. 톤 swap 시 ~80개 토큰의 값을 한꺼번에 바꿔야 했고, "어디가
의미적으로 같은 곳인지" 추적 불가.

이제는 **3-layer** — 의미와 구현이 분리:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — Raw Value (theme preset)                          │
│   [data-theme="pop"]      → --raw-accent-pink: #ff5c8a;     │
│   [data-theme="editorial"]→ --raw-accent-pink: #1d1b20;     │
└─────────────────────────────────────────────────────────────┘
                          ↓ (var ref)
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 — Semantic (의미)                                   │
│   --accent-action: var(--raw-accent-pink);                  │
│   --surface-card:  var(--raw-surface-card);                 │
│   --fg-primary:    var(--raw-ink-100);                      │
└─────────────────────────────────────────────────────────────┘
                          ↓ (var ref)
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Component (컴포넌트 매핑)                         │
│   --sidebar-active-bg: var(--accent-action);                │
│   --canvas-card-bg:    var(--surface-card);                 │
│   --canvas-card-header-text: var(--fg-primary);             │
└─────────────────────────────────────────────────────────────┘
                          ↓ (var ref)
┌─────────────────────────────────────────────────────────────┐
│ Tailwind utility (@theme) — 기존 이름·utility 보존          │
│   --color-amore: var(--raw-accent-purple);                  │
│   .bg-amore  → background-color: var(--color-amore);        │
│   .text-ink  → color: var(--color-ink);                     │
└─────────────────────────────────────────────────────────────┘
```

**효과**:
- 새 톤 추가 = Layer 1 새 `[data-theme]` 블록 1개. Layer 2/3 변경 0.
- 회귀 위험 격리 — Layer 1 만 검증하면 됨 (semantic mapping 은 변경 0).
- 컴포넌트 호출 형태 안 바뀜 — `bg-amore`, `border-line`, `var(--canvas-bg)` 그대로.

### 1.2 Layer 1 — Raw Value Tokens

`src/app/globals.css` 의 `:root, [data-theme="pop"]` / `[data-theme="editorial"]`
블록. **각 theme 마다 동일 키 set 을 모두 정의해야 함** — semantic layer 가
`var(--raw-X)` 을 참조하므로 누락 시 default 가 없으면 invalid.

#### 키 카테고리

| 카테고리 | prefix | 예시 | 설명 |
|---|---|---|---|
| Surface | `--raw-surface-*` | `--raw-surface-page` `--raw-surface-card` | 배경 layer |
| Ink (FG) | `--raw-ink-*` | `--raw-ink-100` `--raw-ink-60` | foreground 명도 scale |
| Border 색 | `--raw-border-*` | `--raw-border-strong` `--raw-border-medium` | 테두리 색 |
| Border width | `--raw-border-width-*` | `--raw-border-width-medium` `--raw-border-width-heavy` | 두께 |
| Shadow | `--raw-shadow-*` | `--raw-shadow-hard-md` `--raw-shadow-soft` | 그림자 |
| Accent | `--raw-accent-*` | `--raw-accent-pink` `--raw-accent-purple` | 액션·브랜드 색 |
| Pastel | `--raw-pastel-*` | `--raw-pastel-mint` `--raw-pastel-lav` | 위젯 헤더·하이라이트 팔레트 |
| Signal | `--raw-signal-*` | `--raw-signal-success` `--raw-signal-warning` | 상태 색 |
| Radius | `--raw-radius-*` | `--raw-radius-xs` `--raw-radius-sm` | 모서리 반경 |
| Pattern | `--raw-pattern-*` | `--raw-pattern-dot` | dot grid 등 background pattern |
| Font | `--raw-font-*` | `--raw-font-sans` `--raw-font-hand` | font-family |

전체 키 목록은 `src/app/globals.css` 의 Layer 1 블록 (`:root, [data-theme="pop"]`)
이 SSOT.

### 1.3 Layer 2 — Semantic Tokens

Layer 2 는 **theme-agnostic** — 어떤 톤이 와도 의미 자체는 변하지 않음.

| 카테고리 | 토큰 | 의미 |
|---|---|---|
| Surface | `--surface-page` | 페이지 배경 |
| | `--surface-card` | 카드 표면 |
| | `--surface-elevated` | 한 단계 떠 보이는 표면 (input bg, card secondary) |
| | `--surface-accent-bg` | 액센트 배경 (사이드바 / 캔버스 배경) |
| | `--surface-accent-bg-strong` | 강한 액센트 (로고 banner) |
| | `--surface-banner` | 카드 header banner |
| Foreground | `--fg-primary` | 1차 텍스트 |
| | `--fg-secondary` | 2차 텍스트 |
| | `--fg-mute` | 보조 텍스트 |
| | `--fg-mute-soft` | 매우 보조 |
| | `--fg-inverse` | 어두운 배경 위 텍스트 |
| Border | `--border-strong` | 강한 테두리 (pop: black / editorial: thin line) |
| | `--border-medium` | 보통 |
| | `--border-subtle` | 약한 |
| Accent | `--accent-action` | 액션 색 (버튼·active state) |
| | `--accent-brand` | 브랜드 색 (eyebrow·focus) |
| Signal | `--signal-success` | 성공 |
| | `--signal-warning` | 경고 |
| Component foundation | `--component-card-border-width` | 카드 두께 |
| | `--component-card-radius` | 카드 반경 |
| | `--component-card-shadow` | 카드 그림자 |
| | `--component-button-border-width` | 버튼 두께 |
| | `--component-button-shadow` | 버튼 그림자 |

### 1.4 Layer 3 — Component Tokens

컴포넌트별 매핑. **기존 globals.css 의 토큰 이름을 모두 보존** — 호출처 변경 0.

| Scope | 토큰 prefix | 예시 |
|---|---|---|
| Canvas (/canvas) | `--canvas-*` | `--canvas-bg` `--canvas-card-shadow` `--canvas-accent` |
| Sidebar | `--sidebar-*` | `--sidebar-bg` `--sidebar-active-bg` `--sidebar-nav-radius` |
| Memphis shadow | `--memphis-*` | `--memphis-shadow-sm` `--memphis-shadow-xs` |
| Widget header | `--widget-header-bg-*` | `--widget-header-bg-sky` `--widget-header-bg-default` |

### 1.5 Tailwind @theme — utility 생성 source

`@theme { ... }` 블록은 Tailwind v4 가 utility (bg-amore, text-ink, ...) 를
생성하는 곳. 기존 토큰 이름 (`--color-amore`, `--color-paper`, ...) 그대로
보존하고, 값만 `var(--raw-*)` 참조로 교체 → 톤 swap 시 자동 따라감.

**예외 — font-size scale (`--text-xs` ... `--text-display`)**: 톤 swap 영향
받지 않는 구조적 스케일. literal px 그대로 (재정렬 시 utility 전부 invalidate).

---

## 2. 현재 등록된 Theme

### 2.1 `pop` (default)

**컨셉**: Memphis pop — 검정 굵은 border + offset hard shadow + 노란 banner +
핑크 accent + 32px dot grid.

| 속성 | 값 |
|---|---|
| Surface page | `#ffffff` 흰색 |
| Surface accent | `#fffce1` 노랑 (사이드바/캔버스 배경) |
| Border | `#000000` 검정, 2.5~3px |
| Shadow | `6px 6px 0 #000` hard offset |
| Accent action | `#ff5c8a` 핑크 |
| Accent brand | `#a06fda` 보라 (bento amore) |
| Font | Pretendard Variable |
| Pattern | 32px radial dot grid |

`<html data-theme="pop">` (default — 명시 안 하면 :root 가 매칭).

### 2.2 `editorial` (reference)

**컨셉**: 옛 톤 — 1px line border + warm cream surface + soft shadow + mono
accent + dot grid 없음.

| 속성 | 값 |
|---|---|
| Surface page | `#fbf7f2` warm cream |
| Surface accent | 동일 (액센트 없음) |
| Border | `rgba(29,27,32,0.10)` thin line, 1px |
| Shadow | soft (0 8px 24px rgba) |
| Accent action | `#1d1b20` mono (검정) |
| Accent brand | `#1d1b20` mono |
| Font | Pretendard Variable (동일) |
| Pattern | none |

**용도**: 사용자가 다음 톤 swap 의도 → reference. 개발자 도구에서
`document.documentElement.setAttribute('data-theme','editorial')` 또는
프로젝트 page level 에서 attr 변경하면 전 앱이 옛 톤으로 즉시 전환.

### 2.3 새 톤 추가 — 1 PR 가이드

```css
/* src/app/globals.css 에 추가 */
[data-theme="brutalist"] {
  /* Layer 1 만. semantic + component 는 자동 cascade. */
  --raw-surface-page: #f0f0f0;
  --raw-surface-card: #ffffff;
  --raw-surface-elevated: #e0e0e0;
  --raw-surface-accent-yellow: #ffe156;
  --raw-surface-accent-yellow-strong: #ffeb70;
  --raw-surface-banner-yellow: #ffe156;
  --raw-surface-nav-hover: #fff5b8;

  --raw-ink-100: #000000;
  --raw-ink-80: #111111;
  --raw-ink-60: #333333;
  --raw-ink-40: #666666;
  --raw-ink-mid: #444444;

  --raw-border-strong: #000000;
  --raw-border-medium: #000000;
  --raw-border-subtle: rgba(0,0,0,0.2);

  --raw-border-width-hairline: 1px;
  --raw-border-width-medium: 3px;
  --raw-border-width-strong: 4px;
  --raw-border-width-heavy: 5px;

  --raw-shadow-hard-md: 8px 8px 0 #000;
  --raw-shadow-hard-sm: 4px 4px 0 #000;
  --raw-shadow-hard-xs: 2px 2px 0 #000;
  --raw-shadow-chrome: 6px 6px 0 #000;
  --raw-shadow-soft: 0 2px 0 #000;

  /* ... 나머지 raw-* 키 전체 ... */
}
```

**그 다음 단계**:
1. `<html data-theme="brutalist">` 명시 (layout.tsx) 또는 user toggle
2. 모든 라우트 preview sweep — 시각 검증
3. 1 PR 완성. semantic / component / 컴포넌트 코드 변경 0.

---

## 3. Primitive 카탈로그 — 토큰 매핑

`src/components/ui/` 에 있는 모든 primitive. 각 항목 variant + size + 사용
토큰. 시각 카탈로그 페이지 `/design-system` (super admin gate) 도 함께 참고.

### 3.1 Button (`button.tsx`)
- **variant**: `primary` · `secondary` · `ghost` · `destructive` · `link` · `destructive-link`
- **size**: `xs` · `sm` · `md` · `lg` · `cta`
- **사용 토큰**:
  - 색: `bg-ink` `text-paper` `text-ink` `border-line` `bg-paper` `bg-paper-soft` `text-mute` `text-amore` `text-warning` `border-warning` `border-ink`
  - 그림자: pop 톤은 hard offset (`shadow-[3px_3px_0_black]` `shadow-[2px_2px_0_rgba(0,0,0,0.15)]`)
  - 반경: `rounded-sm` (대부분), `rounded-full` (cta)
- **a11y**: focus-visible 시 `border-amore` 강조.
- **opt-out**: `data-canvas-action` 어트리뷰트로 `[data-canvas-body] button` cascade 회피 (PR #466).

### 3.2 IconButton (`icon-button.tsx`)
- **variant**: `ghost` · `ghost-danger` · `ghost-brand` · `bordered`
- **size**: `compact` · `sm` (24×24) · `md` (28×28) · `lg` (32×32)
- **사용 토큰**: `border-line` `border-ink` `bg-paper` `text-ink` `text-mute` `text-amore` `text-warning` + 모든 size 에서 `shadow-[2px_2px_0_rgba(0,0,0,0.15)]`
- **a11y**: `aria-label` 필수 (TypeScript 강제).
- **opt-out**: `data-canvas-action` 자동.

### 3.3 ChromeButton (`chrome-button.tsx`)
- **variant**: `default` · `mute` · `primary`
- **size**: `xs` · `sm` · `md` · `lg`
- **용도**: chrome (탑바/툴바) 영역 전용. 사이드바·캔버스 chrome 액션과 통일된 두께/그림자.

### 3.4 Input (`input.tsx`) · Textarea (`textarea.tsx`) · Select (`select.tsx`) · ChromeInput (`chrome-input.tsx`) · ChipInput (`chip-input.tsx`)
- **size** (Input/Select): `sm` (text-md) · `md` (text-lg)
- **사용 토큰**: `border-line` 기본 / `border-ink` focus + Memphis 그림자
- **ChromeInput**: 작은 변형 (toolbar inline input).
- **ChipInput**: 다중 선택 칩 + 자유 입력.

### 3.5 Checkbox (`checkbox.tsx`)
- size 1종 (`md` default). 색은 `accent-amore` 토큰화 — 톤 swap 시 자동 적용.

### 3.6 Slider (`slider.tsx`) · Label (`label.tsx`) · Skeleton (`skeleton.tsx`)
- **Slider**: native `<input type=range>` wrapping + memphis 그림자.
- **Label**: `text-mute` semantic label primitive.
- **Skeleton**: variant `text` · `block` · `circle`. 로딩 placeholder.

### 3.7 Modal (`modal.tsx`)
- **size**: `sm` (420) · `md` (560) · `lg` (760) · `xl` (1100) — max-width literal.
- **a11y**: `aria-modal` + `role="dialog"` + `aria-labelledby`.
- **z-index**: `z-modal` utility token (= 50).
- **dismissOnBackdrop**: optional.

### 3.8 FileDropZone (`file-drop-zone.tsx`)
- Drag-drop 패널 + click-to-upload. Memphis 톤 적용 (border-2 dashed → border-ink hover).

### 3.9 EmptyState (`empty-state.tsx`)
- 빈 화면 (테이블·리스트·결과 없음). 헤드라인 + body + optional action.

### 3.10 BrandLoader (`brand-loader.tsx`)
- 브랜드 mascot + sway 애니메이션. `.brand-sway` keyframe.
- **사용 토큰**: globals.css `@keyframes brandSway`.

### 3.11 JobProgress (`job-progress.tsx`)
- 진행률 indeterminate / determinate. `--color-amore` accent.
- **사용 토큰**: `@keyframes jobProgressIndeterminate`.

### 3.12 DropdownMenu (`dropdown-menu.tsx`) · DownloadMenu (`download-menu.tsx`) · ShareMenu (`share-menu.tsx`)
- portal 기반 dropdown. `z-overlay` 사용.

### 3.13 Widget primitives (`src/components/canvas/shell/`)
- **WidgetShell** — 카드 shell + 헤더 영역. `--canvas-card-bg` `--canvas-card-shadow` `--canvas-card-header-bg` `--canvas-card-header-text` 사용.
- **WidgetOutputs** — "최근 산출물" 영역 SSOT (여러 위젯이 공통 표시).
- **widget-header-color.tsx** — `--widget-header-bg-*` 팔레트 매핑 helper.

### 3.14 Layout shells
- **Sidebar** (`src/components/sidebar.tsx`) — `--sidebar-*` 토큰 전부 사용.
- **Topbar** — Topbar 없음 (PROJECT.md §11 — 사이드바 하단 톱니 위젯이 대체).
- **Canvas page bg + dot pattern** — `[data-canvas]` selector + `--canvas-bg-image`.

---

## 4. Hardcoded 색 audit (잔존)

### 4.1 globals.css
모두 `--raw-*` 토큰 안. ✅ raw layer 정의이므로 의도된 hex.

### 4.2 src/**/*.tsx — 139건 잔존 (2026-06-28 기준)

```bash
grep -rnE "#[0-9a-fA-F]{3,6}\b" src/ --include="*.tsx" --include="*.ts" | wc -l
# 139
```

**카테고리**:
| 카테고리 | 예시 위치 | 사유 |
|---|---|---|
| Chart axis / data viz | `desk-analytics-panel.tsx` `credits-usage-predictor.tsx` | recharts series 색 — 의도된 hard value (data viz palette) |
| SVG path fill | `loading.tsx` `brand-loader.tsx` `google-signin-button.tsx` | brand mark / 일러스트 — 톤 swap 영향 X |
| Marketing landing | `credits/page.tsx` `credits-bundles.tsx` | 마케팅 페이지 hero·배너 — 별 톤 (정책 결정 필요) |
| 잔존 컴포넌트 | `topbar-account.tsx` `translate-console.tsx` `translate-viewer.tsx` `report-generator.tsx` `member-row.tsx` `cookie-consent-banner.tsx` | 미토큰화 — 후속 PR 에서 sweep 대상 |
| API route (server) | `translate/recordings/[id]/download/route.ts` | DOCX preview 등 server-side 생성 색 — DOM 토큰 무관 |
| Canvas board literal | `canvas-board.tsx` | 캔버스 chrome literal — `data-canvas` selector 안 `var(--canvas-*)` 토큰화 중 |
| `/design-system` 카탈로그 | `design-system/page.tsx` | 카탈로그 자체에서 토큰 값을 표시할 때 hex literal 보여줌 — 의도됨 |

**후속 PR 대상** (잔존 컴포넌트 카테고리만): topbar-account · translate-console · translate-viewer · report-generator · member-row · cookie-consent-banner 등 → 별 PR 로 sweep. 본 PR 범위 밖.

### 4.3 검사 명령
```bash
# 전체 카운트
grep -rnE "#[0-9a-fA-F]{3,6}\b" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules" | wc -l

# 파일별 분포
grep -rlE "#[0-9a-fA-F]{3,6}\b" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules" | sort -u

# 특정 파일 자세히
grep -nE "#[0-9a-fA-F]{3,6}\b" src/components/translate-console.tsx
```

---

## 5. 톤 swap 가이드 (1-PR 워크플로우)

### 5.1 새 톤 추가 절차

| Step | 내용 | 변경 파일 |
|---|---|---|
| 1 | `globals.css` 에 `[data-theme="<new>"] { ... }` 블록 추가 (Layer 1 만, 모든 `--raw-*` 키 필수) | `src/app/globals.css` |
| 2 | `<html data-theme="<new>">` 명시 또는 사용자 toggle 컴포넌트 | `src/app/[locale]/layout.tsx` 또는 user setting UI |
| 3 | preview 환경에서 모든 주요 라우트 sweep — 시각 점검 | 검증만 |
| 4 | PR 본문에 영향 라우트 / 회귀 점검 결과 첨부 | PR description |

### 5.2 검증 sweep — 톤 swap 시 점검 라우트

```
- /                      (landing)
- /dashboard
- /canvas                (dot grid + widget shell)
- /projects · /members · /credits · /settings
- /quotes · /desk · /recruiting · /interviews · /probing · /translate
- /design-system         (카탈로그 — primitive 시각 동일 확인)
- 로그인 모달 · 쿠키 배너 · 모든 dialog
```

### 5.3 회귀 시 디버그 절차

증상 → 원인 → 점검

| 증상 | 가능한 원인 | 점검 |
|---|---|---|
| 일부 영역만 톤 안 따라감 | 컴포넌트가 hex literal 직접 사용 | 위 §4 audit 명령으로 해당 파일 grep |
| 색이 완전 깨짐 (검정 박스 등) | Layer 1 키 누락 (cascade fallback 없음) | DevTools → Computed → `--raw-*` 변수 inspect |
| 그림자 모양 차이 | `--raw-shadow-*` 값 형식 (length list) 미스 | hard offset vs soft 의 형식 차이 확인 |
| Tailwind utility (`bg-amore` 등) 미적용 | `@theme` 블록의 var ref 가 누락 | `globals.css @theme` 안 `var(--raw-*)` 매핑 확인 |
| Dot grid 안 나옴 | `--raw-pattern-dot: none` 인 경우 (editorial 등) | 의도됨. `--raw-pattern-dot` 값 확인 |

### 5.4 user-facing theme switcher (미래)

```tsx
// src/components/theme-switcher.tsx (미구현 — 별 PR)
'use client';
import { useEffect, useState } from 'react';

const THEMES = ['pop', 'editorial'] as const;
type Theme = typeof THEMES[number];

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>('pop');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // (option) localStorage 에 저장 → 재방문 시 복원
    localStorage.setItem('theme', theme);
  }, [theme]);
  return (
    <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
      {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
```

---

## 6. 비개발자 설명 — 옷장 비유 (PROJECT.md §9.1 보강)

지금까지 옷장 정리는 **옷걸이 (primitive)** 와 **옷 (페이지)** 를 각각 따로 갈았다.
이번엔 **옷장 전체 시스템** 을 만든다:

| 이름 | 무엇 | 비유 |
|---|---|---|
| **Layer 1 (Raw)** | 색·두께·질감 SSOT | 재료 카탈로그 — "검정 면 / 노란 면 / 핑크 면" |
| **Layer 2 (Semantic)** | 의미 매핑 | 부품 카탈로그 — "표면 1번 = 흰 면, 테두리 1번 = 검정 굵은 면" |
| **Layer 3 (Component)** | 컴포넌트 매핑 | 완성품 카탈로그 — "옷걸이 = 부품 1번 + 2번" |

다음 톤 swap 할 땐 **재료 카탈로그 1장만 새 종이로 교체** — 부품/완성품 다
자동 따라옴. 사용자가 직접 옷걸이 / 옷 / 액세서리 일일이 만질 필요 없음.

---

## 7. 변경 이력

- **2026-06-28** — 첫 작성. globals.css 3-layer 토큰 + `data-theme="pop"` / `editorial` 두 preset + `<html data-theme>` 게이트 + Primitive 카탈로그 + Hardcoded 색 audit + 톤 swap 가이드. PR `feat/design-system-comprehensive-ssot`.
- **2026-06-28** — inbox 갱신 패턴 도입 (`docs/DESIGN_SYSTEM_PENDING.md`). §0.5 갱신 룰 + self-check 트리거 표. 같은 PR 안에서 함께 머지 (SSOT 도입과 갱신 메커니즘은 한 쌍).
