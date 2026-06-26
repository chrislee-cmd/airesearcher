# Design Token Audit — 2026-06-26 (PR-D8 Phase 0)

> **목적**: 사용자 명시 — *"토큰 단위, primitive 단위에서 여전히 과거 디자인 시스템이 활용되는 부분이 있는 것 같아. 이거 한번 전체 점검 audit 해줘"*. D1~D5 (canvas pop + 사이드바·헤더 pop 통일) 가 머지된 시점의 토큰 SSOT (`src/app/globals.css`) 잔재를 점검.
> **상태**: 진단만. **코드 변경 0, production 영향 0**.
> 이 doc 은 후속 fix PR (D9+) 의 근거.

---

## 0. TL;DR (사용자 5분 파악)

- 디자인 시스템에 **3개 톤이 공존**한다. 정합성이 깨진 게 아니라 *의도된 hybrid* — 그러나 어느 톤이 어디까지 적용되는지 코드/문서로 명문화되어 있지 않아 후속 개발자가 잘못된 패턴을 답습할 위험.
  - **bento (warm cream, ≈80% 잔재)** — app shell 외 모든 라우트 본문, 모달, primitive 의 기본 톤. `text-mute-soft 324회`, `border-line 248회`, `bg-paper 182회` 등 토큰 사용 빈도 1~3위 모두 bento.
  - **canvas pop (Memphis 노랑/검정/핑크)** — `/canvas` 라우트 본문에만 `data-canvas / data-canvas-body` 로 scope. consumer 7개 파일.
  - **shell pop (D5 — 사이드바 + topbar)** — `--sidebar-* / --memphis-*` 토큰 56회 사용, consumer 4개 파일 (sidebar / sidebar-account / topbar / canvas의 헤더).
- **죽은/희박 토큰 4개**: `--color-pacific`, `--color-pacific-bg` (1회씩), `--color-gray-warm` (1회), `--color-amore-tint` (0회 grep — primitive/JSX 사용 0). 정리 또는 deprecation 후보.
- **고아 primitive 1개**: `src/components/topbar.tsx` (122줄, D5 pop 톤 적용) 가 `(app)/layout.tsx` 에서 더 이상 import 되지 않음. canvas-mock 등 죽은 경로에서만 참조 가능성. 확인 후 제거 후보.
- **bento 4종 CSS 클래스 (`.bento-card / .bento-surface / .bento-pill / .bento-tag`) 사용 0회**. `globals.css` 154–201 줄 50 라인 dead code.
- **위험도 = Low~Medium**. 시각 회귀나 a11y 위반은 없음. 후속 작업의 *clarity* 와 *교육 비용* 이 주요 손실.

---

## 1. globals.css @theme 토큰 inventory

`src/app/globals.css:9–128` 의 모든 토큰을 카테고리·값·grep 빈도와 함께 나열. 빈도는 `grep -rhoE "(text|bg|border)-<name>" src/ --include="*.tsx"` 기준 (Tailwind utility) + `grep "var(--<name>)" src/` 기준 (CSS var 직접 사용).

### 1.1 Brand · Accents

| 토큰 | 값 | utility 사용 | var() 사용 | 톤 | 상태 |
|---|---|---|---|---|---|
| `--color-amore` | `#a06fda` | 124+67+46 = **237** | 5 | bento purple | ✅ active SSOT (link/focus/CTA/eyebrow) |
| `--color-amore-soft` | `#b690e2` | 1 | 0 | bento | 🟡 거의 미사용. eyebrow 변형용으로 도입됐으나 실사용 미미 — 보존 OK |
| `--color-amore-bg` | `#e7defe` | 19 | 0 | bento | ✅ active (small surface tint) |
| `--color-amore-tint` | `#d6c3fb` | **0** | 0 | bento | ❌ **dead** — 정의 후 한 번도 사용 안 됨. 제거 후보 |
| `--color-pacific` | `#1d1b20` | 1 | 0 | legacy editorial naming | 🟡 `--color-ink` 와 값 동일. naming 중복 — alias 권장 또는 제거 |
| `--color-pacific-bg` | `#f3f0eb` | 1 | 0 | legacy editorial | 🟡 1회만 사용 (`.bento-tag` 안). 사실상 dead |

### 1.2 Text · Lines

| 토큰 | 값 | utility 사용 | var() 사용 | 상태 |
|---|---|---|---|---|
| `--color-ink` | `#1d1b20` | 132+61+36 = **229** | 4 | ✅ primary text SSOT |
| `--color-ink-2` | `#2a262f` | 258+9+10 = **277** | 0 | ✅ secondary text SSOT (heading) |
| `--color-mute` | `#5b5965` | 225+0+2 = **227** | 0 | ✅ body mute |
| `--color-mute-soft` | `#8a8693` | 324+2+4 = **330** | 0 | ✅ 최다 사용 (helper/caption) — WCAG AA 미달 가능 (`docs/design-system-audit-2026-05-31.md` §0 결정적 약점 #2) |
| `--color-gray-warm` | `#6f6c78` | 0+0+1 = **1** | 0 | 🟡 거의 미사용. naming 도 어색 (mute 류와 차이 불분명) |
| `--color-line` | `rgba(29,27,32,.10)` | 248+0+8 = **256** | 0 | ✅ primary border |
| `--color-line-soft` | `rgba(29,27,32,.06)` | 134+0+16 = **150** | 0 | ✅ subtle border + skeleton bg |
| `--color-paper` | `#fbf7f2` | 182+34+0 = **216** | 1 | ✅ page bg SSOT |
| `--color-paper-soft` | `#fefaf5` | 63+2+0 = **65** | 0 | ✅ card surface |

### 1.3 Bento pastels

| 토큰 | 값 | utility 사용 | 상태 |
|---|---|---|---|
| `--color-lav` | `#e7defe` | 2 | 🟡 `--color-amore-bg` 와 값 동일 — 의미 중복. naming 정리 후보 |
| `--color-peach` | `#ffd9c9` | 1 | 🟡 거의 미사용 (`.hl.peach` highlighter 변형) |
| `--color-mint` | `#cdebd9` | 2 | 🟡 거의 미사용 |
| `--color-sun` | `#fff1b6` | 1 | 🟡 거의 미사용 (`.hl` 기본 highlighter) |
| `--color-sky` | `#cfe6ff` | 1 | 🟡 거의 미사용 |
| `--color-rose` | `#ffd0e2` | 2 | 🟡 거의 미사용 |

→ 6 파스텔 중 5종이 1~2회. *디자인 시스템에 정의된 팔레트 vs 실제 사용 사이 큰 gap*. design-system 카탈로그가 이 6종을 한 곳에 보여주는 것이 유일한 다소비 처. 의도된 보유라면 OK, 정리 의도라면 inventory 압축 후보.

### 1.4 AM/PM · Signal

| 토큰 | 값 | utility 사용 | 상태 |
|---|---|---|---|
| `--color-am-accent` | `#fb923c` | 1 | ✅ chart 전용 (의도) |
| `--color-pm-accent` | `#6c7aff` | 1 | ✅ chart 전용 |
| `--color-success` | `#16a34a` | 1+0+3 = **4** | ✅ |
| `--color-warning` | `#fb923c` | 55+18+6 = **79** | ✅ error/destructive SSOT. `am-accent` 와 값 충돌 (의도?) |
| `--color-warning-bg` | `#fff1e6` | 7 | ✅ |
| `--color-warning-line` | `#ffd9bf` | 1+5 = **6** | ✅ |

### 1.5 Radius

| 토큰 | 값 | 사용 패턴 |
|---|---|---|
| `--radius-xs` | `4px` | `rounded-xs` — chip/badge |
| `--radius-sm` | `14px` | `rounded-sm` — 카드·모달·입력 기본 |
| `--radius-md` | `24px` | `rounded-md` — 7회 (대형 카드, login/cookie/StatCard/canvas-board) |
| `--radius-lg` | `32px` | `rounded-lg` — 1회 (design-system 카탈로그 demo 내부) — 사실상 dead |
| `--radius-pill` | `999px` | `rounded-full` — pill |

→ `--radius-lg` 미사용. design-system 카탈로그 갱신 시 *언제 쓰는지* 명문화 OR 제거.

### 1.6 Font-size (B-1 9-bucket consolidation)

`--text-xs / xs-soft / sm / md / lg / xl / 2xl / 3xl / display` — 모두 활발히 사용. 781-site `text-[Npx]` migration 이 완료되어 (`grep -rEn 'text-\[[0-9]+(?:\.[0-9]+)?px\]' src/ → 0건`) lint hard-block 전환 가능 상태.

→ **D-? 후보**: B-1 hard-flip — `text-[Npx]` 를 `error` 로 승격 (이미 baseline 0).

### 1.7 Shadow

| 토큰 | 값 | 사용 |
|---|---|---|
| `--shadow-bento` | `0 1px 2px rgba(29,27,32,.04), 0 8px 24px rgba(29,27,32,.06)` | 10 |
| `--memphis-shadow-sm` | `3px 3px 0 #000` | 4 (sidebar) |
| `--memphis-shadow-xs` | `2px 2px 0 #000` | 2 (sidebar) |

→ bento + pop 공존 OK. 단 `editorial.tsx`/`login/page.tsx`/`cookie-consent-banner.tsx`/`dashboard/page.tsx` 등 6곳은 `--shadow-bento` 를 안 쓰고 **풀 hex 값을 utility 안에 inline** (`[box-shadow:0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.06)]`). 토큰화 후보 (§3 하드코드 보고서 참조).

### 1.8 Canvas pop tokens (`/canvas` scope)

`--canvas-bg / -bg-image / -bg-size / -card-bg / -card-border / -card-border-width / -card-radius / -card-shadow / -card-header-* / -card-mute / -accent / -edge / -edge-live / -edge-width / -chrome-* / -selection-*` (총 23개). 모두 `[data-canvas] / [data-canvas-body]` CSS selector + `widget-shell.tsx` / `canvas-board.tsx` 의 inline style 로 소비. **scope 가 명확**.

### 1.9 Shell pop tokens (D5 — 사이드바/topbar)

`--sidebar-bg / -bg-strong / -border / -border-width / -nav-bg / -nav-bg-hover / -nav-border / -nav-border-width / -nav-radius / -active-bg / -active-text / -active-border / -group-heading / --memphis-shadow-{sm,xs}` (총 14개). consumer 4 파일 (`sidebar.tsx 34`, `sidebar-account.tsx 20`, `topbar.tsx 5`, `canvas-board.tsx 1`).

→ **D5 후속 검토**: topbar.tsx 는 `(app)/layout.tsx` 에서 import 안 됨 (grep 결과 0). dead code 가능성. canvas-mock 등 (canvas-lab) 잔재 의존 확인 필요 (§5 risk matrix 의 D-? 참고).

### 1.10 Z-index (이미 토큰화 완료)

`z-table-sticky / z-table-cell-sticky / z-table-resize / z-fab / z-modal / z-toast / z-overlay` — 모두 utility, 0건 `z-[N]` 잔재 확인 (lint hard-block).

---

## 2. 옛 ↔ 신규 토큰 매핑

| 카테고리 | 옛 (editorial v1) | 현재 (bento) | 비고 |
|---|---|---|---|
| brand accent | `--color-amore` = navy `#0e2f5b` | `#a06fda` (purple) | 이름 유지, 값 교체 |
| page bg | `--color-paper` = `#ffffff` | `#fbf7f2` (warm cream) | 이름 유지, 값 교체 |
| card surface | (없음) | `--color-paper-soft` = `#fefaf5` | 신규 |
| radius default | `--radius-sm` = `4px` (editorial 4px-only) | `14px` | 의미 변화 (capsule 도입) |
| radius xs | (없음) | `--radius-xs` = `4px` | editorial 의 4px 가 xs 로 이동 |
| shadow | "no shadow" 원칙 | `--shadow-bento` 도입 | 톤 변경 |
| pastels | (없음) | 6 파스텔 | 신규 (실사용 미미) |

→ `docs/design-system-v2-draft.md` §0 가 같은 진단을 다른 각도에서 정리. v2-draft 는 SSOT 후보지만 **검토 대기 상태로 6주째 방치**.

---

## 3. 후속 PR 우선순위 — 토큰 측면

- **D9 — 토큰 청소 (S size)**
  1. `--color-amore-tint` 제거 (0회)
  2. `--color-pacific / --color-pacific-bg` 제거 또는 `--color-ink` alias 로 정리 (값 동일)
  3. `--color-gray-warm` 제거 또는 사용처 분명히
  4. `--radius-lg` 사용처 명문화 또는 제거
  5. 6 파스텔 중 미사용 4종에 대해 "디자인 시스템에 보유 vs 제거" 의사결정
- **D10 — `--shadow-bento` 일관성 (S size)**
  - login/cookie-consent-banner/editorial 3곳의 hex inline box-shadow → `var(--shadow-bento)` 또는 utility 치환
- **D11 — topbar.tsx 처분 (XS size)**
  - import 그래프 확인 → dead 면 제거, 사용 중이면 `(app)/layout.tsx` 에 wire
- **D12 — design-system v2/v3 doc 승격 (M size)**
  - `docs/design-system-v2-draft.md` 의 SSOT 화 결정. PROJECT.md §9 가 가리키는 외부 doc 과 동기화
- **D13 — B-1 hard flip (XS size)**
  - eslint `Literal[value=/\btext-\[\d+/]` 룰의 severity `warn → error` (이미 0건이라 위험 0)

→ 자세한 fix-PR spec writer input 은 `docs/design-audit-followups-2026-06-26.md` 참고.
