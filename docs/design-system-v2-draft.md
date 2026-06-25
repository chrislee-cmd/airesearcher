# Design System v2 — Draft

> **⚠️ Superseded by v3 (노션 베이스, 2026-06-25)** — v2 의 editorial + bento hybrid 방향은 유지되지 않습니다. 인앱은 노션 베이스 + n8n 캔버스 elevation 으로 전환됐습니다. 새 방향은 `docs/design-system-v3-notion-draft.md` 참조. 이 문서는 히스토리 보존용으로 남깁니다.
>
> **상태**: 검토 대기. **이 문서는 production 에 영향을 주지 않습니다.**
> 검토·승인 후 외부 파일 `/Users/churryboy/AI-researcher/design-system.md` 를
> 이 문서로 교체할 예정. 교체 전까지 기존 doc 들이 SSOT.
>
> **이 doc 이 해결하려는 문제**:
> 현재 디자인 시스템 doc 3개가 모순·중복·누락 상태로 공존하고,
> 그 결과 코드도 hybrid 상태로 굳어졌다. 이 draft 는 **현재 코드의 truth**
> 를 기준으로 doc 을 다시 정렬하고, SaaS 앱이 필요로 하는 컴포넌트
> 카테고리를 빠짐없이 채운다.

---

## 0. 현황 진단 (Doc audit — 이 doc 의 출발점)

### 0.1 동시에 존재하는 세 가지 문서

| doc | 위치 | 마지막 수정 | 톤 | 상태 |
|---|---|---|---|---|
| `design-system.md` | `/Users/churryboy/AI-researcher/` (저장소 외부) | 2026-05-03 | Editorial · 4px radius · no shadow · 아모레퍼시픽 블루 액센트 | 사실상 stale — 코드와 불일치 |
| `design-system-bento.md` | 같은 곳 (저장소 외부) | 2026-05-14 | Bento · 14/24/32px radius · soft shadow · 보라 액센트 + 6 파스텔 | 랜딩·마케팅 면 SSOT, 코드 토큰 값의 source |
| `globals.css` `@theme` | `src/app/globals.css` (저장소 내부) | rolling | Bento 값을 기존 amore/ink/paper 이름에 매핑 — 하이브리드 | **실제 런타임 SSOT** |

### 0.2 결과 — 코드가 어떻게 굳었나

| 영역 | 어디서 왔나 | 현재 코드 상태 |
|---|---|---|
| 컬러 토큰 이름 | Editorial doc (amore, ink, mute, paper, line) | 이름 유지 |
| 컬러 토큰 값 | Bento doc (purple `#a06fda`, warm cream `#fbf7f2`, 파스텔 6개) | bento 값 |
| 카드 radius | 둘 다 ⊥ — 코드가 자체 채택 | `[border-radius:14px]` 198 곳 (in-app), `[border-radius:4px]` 27 곳 (잔존), 24/32 은 랜딩만 |
| Shadow | Editorial: 금지 · Bento: 1개 토큰 사용 | `--shadow-bento` 정의됐지만 in-app 컴포넌트 대부분 미사용 |
| 폰트 | 둘 다 Pretendard 또는 Plus Jakarta Sans 권장 | Pretendard 통일 (코드) |

### 0.3 누락된 컴포넌트 카테고리 (둘 다 비어 있음)

Forms · Modal/Dialog · Tabs · Pagination · Badge · Chip · Avatar · Skeleton · Spinner · ProgressBar · Toast 스펙 · Dropdown 스펙 · Breadcrumb · Tooltip · Popover · Switch · Radio · Checkbox · Table · Dark mode · Focus ring / A11y · 반응형 breakpoint · 아이콘 시스템 (Lucide 사용 중인데 규칙 없음).

→ 두 기존 doc 이 합쳐도 SaaS 앱이 필요로 하는 컴포넌트의 **약 30%만 다룸**.

---

## 1. 이 doc 이 적용되는 범위

| 면 | SSOT | 비고 |
|---|---|---|
| **in-app SaaS 화면** (`/dashboard`, `/quotes`, `/desk`, `/credits`, etc.) | **이 문서** | bento 토큰 값 + editorial 톤 (얇은 hairline, eyebrow) |
| 랜딩 / 마케팅 (`/`, `/affinity-bubble`) | `design-system-bento.md` | bento 풀 표현. 큰 라운드, 파스텔, 손글씨 |
| 리포트형 출력 (interview matrix, desk research 산출물) | 부록 §13 (Editorial 패턴 보존) | 데이터 dense 화면 |

**경계 규칙**: 두 톤을 같은 화면에 섞지 않는다. 라우트 단위로 분리. 동일 컴포넌트가 두 면에 사용되면 prop 으로 톤 분기 (`tone="editorial" | "bento"`).

---

## 2. 디자인 철학 (Principles)

| # | 원칙 | 이유 |
|---|---|---|
| 1 | **Editorial, but not anti-interactive** | 책 페이지처럼 흐르되, 클릭 가능한 곳은 분명하게. 인앱은 dashboard 가 아니지만 도구 모음. |
| 2 | **타이포 우선, 색·그림자 절제** | 위계는 글자 크기/굵기/자간으로. 색은 강조에만, shadow 는 떠야 하는 surface 에만. |
| 3 | **UPPERCASE eyebrow + amore 액센트** | 모든 chapter/카드 위에 작은 메타 라벨. 액센트 색은 5% 미만 면적. |
| 4 | **얇은 hairline (1px) + 14px radius** | 카드의 기본. 더 크면 bento 면(랜딩), 작으면 stat 표(부록). |
| 5 | **단일 SSOT 토큰** | 하드코딩 색·radius·그림자 금지. 모두 `globals.css` 토큰 경유. |
| 6 | **신호 컬러 최소화** | 빨강/초록 차트 컬러 X. amore 1색 + warning 주황 한 가지로 충분. |
| 7 | **데이터는 인라인** | 차트 위젯이 아닌 본문 흐름 안에 막대·따옴표·숫자가 자연스럽게. |

---

## 3. 컬러 토큰 (Tokens — 실측)

`globals.css @theme` 의 실제 값. **여기가 SSOT**, JS 객체 사본 만들지 않는다.

### 3.1 텍스트
| token | value | Tailwind class | 용도 |
|---|---|---|---|
| `--color-ink` | `#1d1b20` | `text-ink` | 본문 강조 · 다크 버튼 배경 |
| `--color-ink-2` | `#2a262f` | `text-ink-2` | 본문 기본 (가장 자주 쓰임) |
| `--color-mute` | `#5b5965` | `text-mute` | 보조 본문 |
| `--color-mute-soft` | `#8a8693` | `text-mute-soft` | 캡션 · helper |
| `--color-gray-warm` | `#6f6c78` | `text-gray-warm` | 거의 사용 X |

### 3.2 액센트
| token | value | class | 용도 |
|---|---|---|---|
| `--color-amore` | `#a06fda` | `text-amore` / `bg-amore` | **primary accent**. eyebrow · pulse · 액센트 라인 |
| `--color-amore-soft` | `#b690e2` | `text-amore-soft` | hover/active mid tone |
| `--color-amore-bg` | `#e7defe` | `bg-amore-bg` | wash 면 |
| `--color-pacific` | `#1d1b20` | `text-pacific` | (== ink, 별칭) |
| `--color-pacific-bg` | `#f3f0eb` | `bg-pacific-bg` | tag 배경 |

> **주의**: 토큰 이름 `amore` 는 옛 아모레퍼시픽 브랜드 잔재. 값은 bento 보라
> (`#a06fda`). 새 컴포넌트 작성 시 이름에 흔들리지 말 것 — 항상 토큰 경유.

### 3.3 Surface / Line
| token | value | class | 용도 |
|---|---|---|---|
| `--color-paper` | `#fbf7f2` | `bg-paper` | 페이지 배경 (warm cream) |
| `--color-paper-soft` | `#fefaf5` | `bg-paper-soft` | 카드 surface, hover/zebra |
| `--color-line` | `rgba(29,27,32,.10)` | `border-line` | 기본 1px hairline |
| `--color-line-soft` | `rgba(29,27,32,.06)` | `border-line-soft` | 약한 구분선 |

### 3.4 Bento 파스텔 (랜딩 + 부분 인앱 강조)
| token | value | class | 용도 |
|---|---|---|---|
| `--color-lav` | `#e7defe` | `bg-lav` | 대표 강조 (icon chip, feature) |
| `--color-peach` | `#ffd9c9` | `bg-peach` | secondary highlight |
| `--color-mint` | `#cdebd9` | `bg-mint` | confirm / positive |
| `--color-sun` | `#fff1b6` | `bg-sun` | highlight (형광펜 60% 기본 색) |
| `--color-sky` | `#cfe6ff` | `bg-sky` | info |
| `--color-rose` | `#ffd0e2` | `bg-rose` | external / partner |

### 3.5 차트 / 시그널
| token | value | 용도 |
|---|---|---|
| `--color-am-accent` | `#fb923c` | AM 차트 (주황) |
| `--color-pm-accent` | `#6c7aff` | PM 차트 (보라) |
| `--color-success` | `#16a34a` | 성공 토스트만 — 본문 차트엔 X |
| `--color-warning` | `#fb923c` | 에러 · destructive |
| `--color-warning-bg` | `#fff1e6` | warning surface |
| `--color-warning-line` | `#ffd9bf` | warning border |

### 3.6 사용 규칙
- 액센트 (`amore`) 면적 5% 미만 — 라벨/라인/소형 막대만
- 신호 컬러 (`success`/`warning`) 는 시스템 피드백에만, 일반 데이터 표현 금지
- 파스텔 6색은 한 grid 안에 동일 색 연속 배치 금지 (lav → mint → peach 처럼 회전)
- **하드코딩 색 절대 금지**. PR diff 에 `#[0-9a-f]{3,6}` 또는 `rgb(`, `rgba(` 가 새로 들어가면 차단

---

## 4. 형태 토큰 (Shape)

### 4.1 Radius
| token | value | 어디에 |
|---|---|---|
| `--radius-sm` | **14px** | **in-app 기본** — 카드·버튼·input·dropdown·toast 등 거의 모든 곳 |
| `--radius-md` | 24px | 랜딩 bento 카드 (`.bento-card`) |
| `--radius-lg` | 32px | 랜딩 큰 surface (`.bento-surface`, voice-card) |
| `--radius-pill` | 999px | pill 버튼, tag, 작은 dot, indicator |

**Tailwind 매핑이 없는 문제** (현재 코드의 통증):
- `rounded-sm/md/lg` 기본값이 토큰과 다름 → 코드가 `[border-radius:14px]` 198 곳 하드 박힘
- **해결책 (별도 PR)**: tailwind v4 `@theme` 에 `--radius-*` 가 정의돼 있으므로 `rounded-sm` 클래스를 우리 토큰에 맞추거나, `rounded-token-sm` 별칭 추가

### 4.2 Border
- 모든 hairline 은 `border-line` (1px solid `rgba(29,27,32,.10)`)
- 더 강조 시 `border-ink-2` 또는 `border-ink`
- **컬러 카드 위에서도 동일 라인 유지** — bento 카드라도 라인은 절대 더 짙게 만들지 않는다

### 4.3 Shadow
- 단 하나의 토큰: `--shadow-bento` (`0 1px 2px rgba(29,27,32,.04), 0 8px 24px rgba(29,27,32,.06)`)
- 사용 대상: **bento card 면, 떠 있는 popover/dropdown, hover 상승**
- **in-app 일반 화면 (table/list/inline panel) 에는 shadow 미사용** — 1px line 으로 면 분리
- **금지**: 다중 shadow 레이어, 색 입힌 shadow, glassmorphism

---

## 5. 타이포그래피

### 5.1 패밀리
- 기본 sans: `--font-sans` = Pretendard Variable → Pretendard → Inter → system
- 손글씨 액센트: `--font-hand` = Caveat (랜딩 squiggle, voice 카드)

### 5.2 텍스트 스타일 스케일

| 역할 | size (px) | weight | tracking | 용도 |
|---|---|---|---|---|
| H1 — 페이지 타이틀 | 24 | 700 | -0.02em | `FeaturePage` 헤더 (`text-[24px] font-bold tracking-[-0.02em]`) |
| H1 — hero (랜딩) | clamp(40,6.5vw,80) | 800 | -0.035em | bento 면 전용 |
| H2 — chapter | 20 | 700 | -0.018em | 챕터 헤더 (Editorial 부록) |
| H3 — card title | 15~17 | 600 | -0.005em | 카드 타이틀 |
| Section title | 18 | 700 | -0.02em | 본문 섹션 |
| Body | 12.5~13 | 400 | 0 | 본문 · line-height 1.6~1.75 |
| Body small | 11.5 | 400 | 0.02em | 보조 본문, helper, sub |
| Caption | 11 | 400 | 0 | 라벨, 메타 |
| Stat — big | 42 | 700 | -0.01em | KPI 숫자 |
| Stat — mid | 17 | 700 | -0.01em | 카드 메타 값 |
| Eyebrow | 10.5~11 | 600~700 | **0.18em ~ 0.22em** | UPPERCASE 라벨 — 시그니처 |

### 5.3 Eyebrow 패턴 (시그니처)
```html
<span class="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-amore">
  Chapter II
</span>
```
또는 globals.css 의 `.eyebrow` 헬퍼 클래스. 모든 카드/섹션 위에 한 줄 — "이게 뭐인지" 를 본문 전에 알려주는 캡션.

### 5.4 Tabular numbers
숫자가 자릿수 의존 정렬을 요구하는 경우 `tabular-nums` 필수 (`text-[11px] tabular-nums`). 가격·진행률·시간 표시 등.

---

## 6. 레이아웃

### 6.1 페이지 컨테이너 (in-app)
```tsx
<div className="mx-auto max-w-[1120px] px-2 pb-16 pt-8">
```
- max-width 1120px (출판물 컬럼)
- 좌우 padding 8px (모바일 좁음) — 페이지 컴포넌트의 안쪽 카드에서 padding 더 줌
- 세로 padding top 32 / bottom 64

### 6.2 `FeaturePage` 헬퍼 (`src/components/ui/feature-page.tsx`)
모든 도구 라우트 공통 헤더. 헤더 우측 슬롯에 `Features.X.cost` 표시.

### 6.3 Grid
- 2 또는 3컬럼만 (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`)
- gap 4 또는 5 (16~20px)
- 4컬럼 이상 금지

### 6.4 섹션 간격
- 섹션 사이 `mb-11` (44px) 또는 `mb-8`
- 헤더 → 본문 `mt-3` ~ `mt-5`
- 그리드 gap `gap-5`

### 6.5 반응형 breakpoint (Tailwind 기본 + 본 시스템 약속)
| name | min-width | 적용 |
|---|---|---|
| (default) | 0 | 모바일 우선 |
| `sm:` | 640px | 2컬럼 진입 |
| `md:` | 768px | sidebar 패널 펼침 |
| `lg:` | 1024px | 3컬럼 진입 |
| `xl:` | 1280px | 본문 최대폭 도달 |

**모바일 우선 작성** — base 클래스가 모바일 상태. 데스크탑 접두사로 확장.

---

## 7. 핵심 컴포넌트

### 7.1 Button — **shared 컴포넌트 없음, inline 패턴**

> 현재 상태: 공유 `<Button>` 컴포넌트 미존재. 모든 버튼이 inline `className` 으로 패턴 반복. **별도 PR 로 `src/components/ui/button.tsx` 추가 권장** — 그 전까지 아래 패턴을 정답으로 본다.

**Primary (filled, dark)**
```tsx
className="border border-ink bg-ink px-4 py-1.5 text-[11.5px] font-semibold text-paper transition-colors duration-[120ms] hover:bg-ink-2 disabled:opacity-60 [border-radius:14px]"
```

**Secondary (outlined)**
```tsx
className="border border-ink bg-paper px-4 py-1.5 text-[12px] font-semibold text-ink transition-colors duration-[120ms] hover:bg-ink hover:text-paper [border-radius:14px]"
```

**Ghost (line only)**
```tsx
className="border border-line bg-paper px-3 py-1 text-[11px] text-mute hover:border-mute-soft hover:text-ink-2 [border-radius:14px]"
```

**Destructive (warning hover)**
```tsx
className="border border-line bg-paper px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[.18em] text-mute hover:border-warning hover:text-warning [border-radius:14px]"
```

**Sizes**:
- xs (uppercase tracking 액션) — `px-2.5 py-1 text-[10.5px]`
- sm (기본) — `px-4 py-1.5 text-[11.5px]`
- md — `px-5 py-2 text-[12px]`
- lg — `px-5 py-2.5 text-[13px]`

**States**:
- disabled: `disabled:cursor-not-allowed disabled:opacity-40` (또는 60)
- loading: 라벨을 `{loading ? tCommon('loading') : t('cta')}` 로 교체
- icon-only: padding 정사각형 + sr-only label

### 7.2 Form Fields — **shared 컴포넌트 없음, inline 패턴**

> 현재 상태: `<Input>`, `<Textarea>`, `<Select>` 공유 없음. native `<input>` 에 클래스로 직접 스타일. **단일 패턴화 PR 권장**.

**Text input / Textarea**
```tsx
className="w-full border border-line bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-mute-soft focus:border-ink focus:outline-none [border-radius:14px]"
```

**Select** (native)
```tsx
className="border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink-2 disabled:opacity-40 [border-radius:14px]"
```

**Focus state**: `focus:border-ink focus:outline-none` (focus ring 별도 룰 §9.2 참고).

**Label**: `<label className="text-[11px] uppercase tracking-[0.22em] text-mute-soft">`

**Helper / error**: 아래 줄 `text-[11px] text-mute-soft` 또는 `text-warning`

### 7.3 FileDropZone (`src/components/ui/file-drop-zone.tsx`)
- props: `accept`, `multiple`, `maxSizeBytes`, `onFiles`, `disabled`, `label`, `helperText`, `onDropRaw`
- 시각: dashed line (`border-dashed border-line`), hover/drag 시 solid + `border-ink`
- 14px radius, 흰 종이 배경, 가운데 정렬 본문
- onDropRaw 로 비-파일 드롭 (workspace artifact) 핸들 가능 — 일관성 위해 모든 업로드 zone 은 이 컴포넌트 사용

### 7.4 EmptyState (`src/components/ui/empty-state.tsx`)
- props: `title`, `description?`, `icon?`, `action?`, `tone?: 'default' | 'subtle'`
- subtle: dashed line + `bg-paper-soft`
- 모든 빈 결과 화면 (검색 결과 0, 업로드 전, 인터뷰 없음) 이 컴포넌트 사용

### 7.5 JobProgress (`src/components/ui/job-progress.tsx`)
- 백그라운드 작업 진행 표시. determinate (0~100) 또는 indeterminate (애니메이션).
- 카드: `border border-line bg-paper-soft [border-radius:14px]`
- 진행 바: `h-1 [border-radius:9999px]` + amore fill
- 우측 우측 cancel 버튼은 destructive ghost 패턴

### 7.6 DropdownMenu (`src/components/ui/dropdown-menu.tsx`)
- Radix 미사용 — 자체 headless
- mousedown-outside + Esc 닫힘
- 패널: `border border-line bg-paper py-1 [border-radius:14px]`
- 아이템: `text-ink-2 hover:bg-line-soft/40 focus:bg-line-soft/40 focus:outline-none`
- 그룹 라벨: `text-[9.5px] font-semibold uppercase tracking-[0.18em] text-mute-soft`
- hint (오른쪽 정렬 보조 텍스트): `font-mono text-[10.5px] tabular-nums`

### 7.7 Toast (`src/components/toast-provider.tsx`)
- Provider 패턴, `useToast().push(msg, { tone })`
- tone: `info | amore | warn`
- 위치: 화면 우하단 (현재 구현)
- ttl 기본 3500ms
- **info 는 일반, amore 는 강조, warn 은 실패 — paywall 모달과 구분 위해 분리**

### 7.8 FeaturePage (`src/components/ui/feature-page.tsx`)
- in-app 모든 도구 라우트의 공통 헤더
- 좌: H1 (`text-[24px] font-bold`) · 우: `headerRight` (보통 cost 표시)
- 그 아래 hairline (`border-b border-line pb-3`)

### 7.9 MochiLoader (`src/components/ui/mochi-loader.tsx`)
- 로고 흔들기 (`mochi-sway` keyframe)
- 긴 로딩 (>1s) 의 visual feedback. 짧은 로딩은 토스트 또는 스피너 한 줄로.

### 7.10 추가로 필요한 컴포넌트 (미존재 — 다음 PR 시 정의)
| 우선순위 | 컴포넌트 | 비고 |
|---|---|---|
| 🔴 High | `<Button />` 공유 | 위 §7.1 패턴을 그대로 코드화 |
| 🔴 High | `<Input/Textarea/Select />` 공유 | 위 §7.2 패턴 코드화 |
| 🟡 Mid | `<Modal/Dialog />` | 현재 ad-hoc 구현 산재 |
| 🟡 Mid | `<Skeleton />` | 로딩 정합성 |
| 🟢 Low | `<Tabs />` | 현재 사용처 적음 |
| 🟢 Low | `<Tooltip />` | 현재 native title 만 사용 |

---

## 8. 패턴 (Patterns)

### 8.1 Eyebrow + accent line (시그니처)
```html
<div class="flex items-center gap-2">
  <span class="inline-block h-px w-6 bg-amore"></span>
  <span class="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-amore">
    Chapter II
  </span>
  <span class="text-[11px] text-mute-soft">· {subtitle}</span>
</div>
```

### 8.2 Hairline divider
- 섹션 사이: `border-b border-line pb-3 mb-5`
- 더 약한 구분: `border-line-soft`
- **세로 divider** 는 거의 안 씀 — 간격으로 분리

### 8.3 Inline 막대 (정량)
```html
<div class="flex items-center gap-2">
  <span class="w-20 text-[11px] text-mute-soft">AM</span>
  <div class="h-1 flex-1 [border-radius:9999px] bg-line-soft overflow-hidden">
    <div class="h-full bg-am-accent" style="width: 72%"></div>
  </div>
  <span class="w-10 text-right text-[11px] tabular-nums text-mute-soft">72%</span>
</div>
```

### 8.4 Verbatim (정성 인용)
```html
<div class="text-[12px] italic leading-[1.6] text-mute">
  "오래 써도 트러블 안 나는 게 가장 중요해서요"
  <span class="not-italic text-mute-soft">— 30대 여 · 민감성</span>
</div>
```

### 8.5 형광펜 highlight (Landing 전용, 본문엔 절제)
- `<span class="hl">` — `--color-sun` 60% 라인
- 색 modifier: `.hl.peach`, `.hl.mint`, `.hl.lav`

---

## 9. 시스템 (System)

### 9.1 아이콘 (Icons)
- **Lucide React** 통일 (`import { X } from 'lucide-react'`)
- 이모지와 lucide 혼용 금지 (carousel 인디케이터 같은 의도적 emoji 는 예외)
- 크기: 기본 `size={14}`, 인라인 `size={12}`, 큰 액션 `size={18}`
- 색: `text-mute-soft` 기본, 인터랙티브 시 `text-ink-2`, 강조 시 `text-amore`
- stroke 두께는 lucide 기본 (2). 더 얇게/두껍게 금지.

### 9.2 Focus / A11y
- 모든 인터랙티브 요소: `focus:outline-none focus-visible:border-ink` (border-driven focus)
- 또는 `focus-visible:ring-2 focus-visible:ring-amore-bg` (ring-driven, 더 강한 표시 필요 시)
- 색만으로 의미 전달 금지 — 텍스트/아이콘 동반
- 키보드 Esc 닫힘은 모든 모달/팝오버 의무
- `aria-label`, `aria-haspopup`, `role` 누락 검증 필요

### 9.3 Motion
| 인터랙션 | duration | easing |
|---|---|---|
| 색·border 트랜지션 | 120ms | ease (`transition-colors duration-[120ms]`) |
| 사이드바 width | 220ms | ease |
| hover lift | 150ms | ease |
| 모달 enter/exit | 200ms | ease-out |
| toast in/out | 250ms | ease-out |

**금지**: 회전 애니메이션, 1.2배 이상 scale, parallax, 색 morph.

### 9.4 다크 모드
- **현재 미지원**. 토큰이 단일 라이트 톤만 정의됨.
- 추가 시 별도 `@theme` block + body class `.dark` 토큰 override 필요.
- 도입 결정 전까지는 light-only 표기 일관성 유지.

### 9.5 모션 reduce
- `@media (prefers-reduced-motion)` 에서 모든 transition duration 을 0 으로 — 현재 미적용. 추가 권장.

---

## 10. Do / Don't

**Do**
- ✓ 토큰만 사용 (`text-ink`, `border-line`, `bg-paper-soft`, …)
- ✓ UPPERCASE eyebrow + amore accent line 으로 섹션을 연다
- ✓ 14px radius (in-app), 24/32 (랜딩) — 그 사이 값 금지
- ✓ hairline 1px + warm-cream surface — bento 면 외엔 shadow 자제
- ✓ 본문 line-height 1.6 이상
- ✓ 숫자는 `tabular-nums` + 두꺼운 weight + 큰 size
- ✓ 정성 인용은 italic + `— 화자` 주석

**Don't**
- ✗ 하드코딩 hex 색·rgba 값 — 모두 토큰 경유
- ✗ 임의 radius (2/3/4/8/10/12px 등) — `14` / `24` / `32` / `999` 만
- ✗ 다중 shadow, 색 입힌 shadow, glassmorphism
- ✗ 신호 컬러 (빨강/초록) 차트 — amore + warning 만
- ✗ 이모지/아이콘 폰트 혼용 — Lucide 통일
- ✗ 한 페이지 4컬럼 이상
- ✗ 페이지 안에서 톤 섞기 (in-app + 랜딩 bento)
- ✗ Radix 신규 도입 — 자체 headless 우선 (`DropdownMenu` 패턴 참고)

---

## 11. Audit 체크리스트 (제품 점검용)

이 doc 이 승격되면 `audit-design-system.md` (별도 작업) 로 분리될 항목들.

### 11.1 자동 감지 가능 (grep / regex)
- [ ] 하드코딩 색: `grep -rE "#[0-9a-fA-F]{3,6}|rgba?\(" src/components/ src/app/` — 토큰 외 발견 0
- [ ] 임의 radius: `grep -rEoh "\[border-radius:[0-9]+px\]" src/` 분포 — 14/24/32/9999 외 0
- [ ] 임의 shadow: `grep -rE "shadow-\[" src/` — 토큰화 또는 제거
- [ ] inline `style={{ color/background/border: ... }}` 발견 시 토큰 클래스로 치환 권장
- [ ] `border-radius:9999px` vs `999px` 일관 (현재 13곳 vs 1곳 — 일치화 필요)

### 11.2 수동 검토
- [ ] 페이지마다 H1 + 헤더 hairline + eyebrow 패턴 일관
- [ ] 모든 빈 상태에 `<EmptyState>` 사용
- [ ] 모든 업로드 zone 에 `<FileDropZone>` 사용
- [ ] 모든 백그라운드 진행에 `<JobProgress>` 사용
- [ ] 모든 인터랙티브 요소 키보드 접근 가능 (Tab + Esc)
- [ ] focus-visible 표시 누락 없음
- [ ] 모바일 (sm 미만) 에서 컬럼 collapse 정상
- [ ] 동일 면 안에서 in-app 톤과 bento 톤 혼재 없음

### 11.3 컴포넌트 누락 점검
- [ ] Button shared 컴포넌트 도입 여부
- [ ] Input/Textarea/Select shared 컴포넌트 도입 여부
- [ ] Modal/Dialog primitive 도입 여부
- [ ] Skeleton primitive 도입 여부
- [ ] Tooltip primitive 도입 여부

---

## 12. 다음 단계 (이 draft 의 승격 워크플로우)

1. **이 draft 검토** — 사용자 코멘트 / 수정
2. (선택) 이 draft 의 룰을 `src/components/ui/` 에 코드화 — 누락된 Button/Input shared 컴포넌트 추가 PR
3. **외부 `design-system.md` 교체 PR** — 이 draft 를 `/Users/churryboy/AI-researcher/design-system.md` 로 복사, 본 draft 파일은 `docs/archive/` 로 이동 또는 삭제
4. **PROJECT.md §9 + §10 갱신** — SSOT 위치를 새 doc 으로 명시, bento doc 의 역할 (랜딩만) 명시
5. **제품 audit 실행** — 위 §11 체크리스트로 grep + 페이지별 review, 위반 사례 PR 분할

---

## 13. 부록 — 리포트형 출력 패턴 (기존 Editorial doc 보존)

interview matrix, desk research result, affinity bubble 등 **리포트 출력 화면** 에서만 사용. 일반 in-app 화면에는 사용 금지.

### 13.1 ChapterHeader
```tsx
<div className="flex items-center gap-2.5">
  <span className="inline-block h-px w-6 bg-amore" />
  <span className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-amore">
    Chapter {num}
  </span>
  <span className="text-[11px] text-mute-soft">· {subtitle}</span>
</div>
<h2 className="text-[20px] font-bold pb-3 border-b border-line">{title}</h2>
<p className="max-w-[820px] text-[12.5px] leading-[1.75] text-mute">{body}</p>
```

### 13.2 StatCard
- `borderTop: 2px solid amore` (액센트 막대)
- UPPERCASE 카드 타이틀 → 큰 숫자 (42/700) → 보조 라벨 (13/mute)

### 13.3 Q→A→Verbatim 트리플
```
Q  소비자는 어떤 순간에 이 카테고리를 떠올리는가?
A  계절 전환기 + SNS 노출이 트리거의 65%
   "환절기에 갑자기 당겨서 검색했어요" — 28F · 건성
```
좌측 1px 라인으로 묶은 블록.

### 13.4 4-Quadrant Cross Map / Aided-Unaided Dual Bars
기존 `design-system.md` §5.8–5.9 의 패턴 그대로 보존. 새 위젯이 필요할 때만 추가.

---

## 14. 변경 이력

- **2026-05-31 (draft)** — 첫 작성. 기존 doc 3개 (외부 design-system.md / 외부 design-system-bento.md / globals.css `@theme`) 의 분기·중복·누락 진단 후, 코드 truth 기준으로 in-app SaaS 디자인 시스템 재정의.

---

## 15. 참고

- `globals.css` — 런타임 토큰 SSOT
- `src/components/ui/*` — primitives 코드
- `design-system-bento.md` (외부) — 랜딩/마케팅 톤 SSOT (이 doc 과 공존)
- 옛 `design-system.md` (외부) — 이 draft 가 승격되면 대체됨
