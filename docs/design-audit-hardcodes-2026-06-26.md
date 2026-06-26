# Hardcode Audit — 2026-06-26 (PR-D8 Phase 0)

> `src/` 안 디자인 토큰 우회 사례 (hex / rgba / 임의 radius / 임의 shadow / 임의 font-size / inline style) grep 보고. *허용 vs 패치* 분류 + 라우트별 통계.
> **상태**: 진단만. **코드 변경 0**.

---

## 0. TL;DR

| 패턴 | 전체 | 허용 (외부 브랜드/SVG/LLM) | 패치 후보 | 비고 |
|---|---|---|---|---|
| `text-gray-{N}` / `bg-gray-{N}` / `border-gray-{N}` | **0** | — | 0 | ✅ Tailwind 디폴트 색 잔재 0 |
| `rounded-md` | 7 | 1 (design-system 카탈로그 demo) | **6** | 대형 카드용 token. login/cookie/StatCard 가 사용 |
| `rounded-lg` | 1 | 1 (카탈로그 demo) | 0 | ✅ 토큰 정의돼 있으나 실사용 0 |
| `rounded-[Npx]` (outlier 2/3/8/10/22) | 19 | — | **19** | 주로 translate-console (4px == rounded-xs 대체 가능) |
| `text-[Npx]` | **0** | — | 0 | ✅ B-1 마이그 완료 (lint hard-block 전환 가능) |
| `z-[N]` | **0** | — | 0 | ✅ lint hard-block |
| `[box-shadow:...]` arbitrary | 6 | 0 | **6** | `--shadow-bento` 토큰화 가능한데 inline hex 사용 |
| hex `#RRGGBB` literal (non-SVG) | **125** | ~80 (LLM prompt / chart data / external brand) | **45** | sidebar 8 / widget-shell 6 / translate-console 10 등 |
| `style={{...}}` inline | 228 | — | 다수 | 대다수는 dynamic value (width/transform/color from data). pop 톤 wire 의 합법 사용도 포함 |

→ 디자인 시스템 hygiene 은 **전반적으로 우수**. 5월 audit (`docs/design-system-audit-2026-05-31.md`) 이래 lint hard-block 6개가 차례로 채택돼 신규 코드는 거의 막힘. **잔재의 대부분은 D5 이전 시점의 합법 패턴 또는 외부 브랜드 색**.

---

## 1. Radius 잔재

### 1.1 `rounded-md` (24px) — 7 사이트

| file:line | 평가 |
|---|---|
| `app/[locale]/(app)/settings/export-data.tsx:84` | ✅ 토큰 사용 (rounded-md = --radius-md 24px). 대형 카드용 의도된 token 사용 |
| `app/[locale]/(app)/canvas/canvas-board.tsx:493` | ✅ canvas card frame |
| `app/[locale]/(canvas-lab)/canvas/shell/widget-shell.tsx:38` | 🟡 **canvas-lab (dev)** — production import 없음 가능 |
| `app/[locale]/login/page.tsx:20` | 🟡 inline box-shadow hex 와 함께 사용. 토큰화 후보 |
| `app/[locale]/(app)/design-system/page.tsx:63` | ✅ catalog demo (자기 자신 설명) |
| `components/cookie-consent-banner.tsx:156` | 🟡 inline box-shadow hex 와 함께 |
| `components/editorial.tsx:52` | 🟡 `StatCard` (1회만 사용). inline box-shadow hex |

→ **D-? 후보**: 3곳 (login/cookie/editorial) 의 hex box-shadow 를 `[box-shadow:var(--shadow-bento)]` 로 치환 (D10 의 일부).

### 1.2 `rounded-[Npx]` (outlier 2/3/4/8/10/22) — 19 사이트

| file | count | 평가 |
|---|---|---|
| `components/translate-console.tsx` | 11 | `rounded-[4px]` — **`rounded-xs` 로 치환 가능** (1:1 매핑). lint `4px` 블록되어 신규 추가는 안 되나 기존이 잔존 |
| `components/translate-viewer.tsx` | 4 | 동일 (`rounded-[4px]`) — `rounded-xs` 치환 가능 |
| `components/insights/quote-search-panel.tsx:44` | 1 | `rounded-[2px]` — outlier (highlight box). token 없음 (의도된 작음) |
| `components/ui/icon-button.tsx:15` | 1 | 코드 주석 안 문자열 (실제 className 아님) — 무시 |
| (sidebar/sidebar-account 의 inline `borderRadius:6` 등) | — | 별도 inline style 로 §3 참조 |

→ **D-? 후보**: translate-console / translate-viewer 15곳을 `rounded-xs` 로 일괄 치환 (XS PR).

### 1.3 outlier 2/3/8/10/22px — 19 사이트

`eslint.config.mjs` 가 *명시적으로 4/14/24/999/9999 만* 차단해 outlier 통과. 디자인 의사결정 대기:

- `2px` — 매우 작은 highlight/track (Slider, quote highlight)
- `3px` — Memphis pop border-width 와 연동 — 토큰 후보 `--radius-pop` 등
- `8px` — Memphis interior interior button radius (`[data-canvas-body] button { border-radius: 8px }`)
- `10px` — 미확인 (1~2건)
- `22px` — 미확인

→ 디자이너 결정 (정규화 vs 보유) 후 토큰화 OR lint 차단 정책.

---

## 2. Shadow 잔재

`--shadow-bento` 정의됨에도 6 사이트에서 hex inline 사용:

| file:line | 패턴 |
|---|---|
| `app/[locale]/login/page.tsx:20` | `[box-shadow:0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.06)]` |
| `components/cookie-consent-banner.tsx:156` | `[box-shadow:0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.08)]` (마지막 alpha 0.08 — 의도? 차이 0.02) |
| `components/editorial.tsx:52` (StatCard) | `[box-shadow:0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.06)]` |
| (그 외 `--shadow-bento` 가 이미 토큰 사용된 곳: dashboard/page.tsx ×2, projects-view.tsx, ui/modal.tsx) | — |

→ **D10 후보**: 3 inline → `[box-shadow:var(--shadow-bento)]` 치환. (`cookie-consent-banner` 의 0.08 차이는 디자이너 확인 — 의도면 별도 토큰 `--shadow-bento-strong`).

---

## 3. Hex `#RRGGBB` 잔재 — 125 사이트 (non-SVG)

### 3.1 파일별 분포 (Top 10)

| file | count | 평가 |
|---|---|---|
| `app/[locale]/(app)/design-system/page.tsx` | 24 | ✅ 카탈로그가 토큰 값을 *문자열로 보여주는* 의도된 표기 |
| `lib/reports/prompts/_shared.ts` | 12 | ✅ LLM 프롬프트 안 색 표기 — 토큰 무관 |
| `components/translate-console.tsx` | 10 | 🟡 6 hex `#000` 류 (Memphis pop) + 4 SVG fallback. 7.4의 회색 gradient `#000` 은 의도된 fade |
| `lib/scheduler/project-colors.ts` | 9 | 🟡 프로젝트 라벨 회전 팔레트 — 토큰화 권장 (am/pm-accent 처럼 도메인 토큰 도입) |
| `hooks/use-realtime-transcription.ts` | 8 | ✅ 코드 주석 안 PR 번호 (`#393` 등) — false positive |
| `components/sidebar.tsx` | 8 | 🟡 D5 잔재. `'#fff' '#000' '#555' '#999'` 의 inline color. `--sidebar-*` 토큰 미사용 outlier |
| `components/desk-analytics-panel.tsx` | 8 | 🟡 차트 색 — am/pm-accent 토큰 활용 가능 |
| `components/landing/panels.{ko,en}.tsx` | 6+6 | ✅ landing page 자체 디자인 시스템 (분리 유지) |
| `components/canvas/shell/widget-shell.tsx` | 6 | 🟡 D2/D5 pop 톤 inline (`#fff #000`) — `--canvas-card-*` 토큰 부분 적용 |
| `components/slidegen/types.ts` | 5 | ✅ slidegen 데이터 모델 안 색 enum — 별 디자인 시스템 |
| `components/sidebar-account.tsx` | 3 | 🟡 `'#fff' '#000'` outlier |

### 3.2 sidebar.tsx 잔재 sample (D5 후속 청소 후보)

```
414:  background: '#fff',                                ← --sidebar-nav-bg 사용 가능
470:  style={{ color: '#555' }}                          ← --color-mute 대체
480:  style={{ color: '#000' }}                          ← --sidebar-border 또는 --color-ink
625:  color: active ? '#fff' : 'var(--canvas-accent)'    ← active = --sidebar-active-text
638:  color: active ? '#fff' : 'var(--color-success...)' ← 동일
725:  color: '#999'                                       ← --color-mute-soft 또는 비슷
```

→ **D-? 후보**: sidebar.tsx D5 후속 cleanup — hex `#fff/#000/#555/#999` 를 sidebar 토큰으로 치환 (S size).

### 3.3 widget-shell.tsx 잔재 sample

`canvas-card-*` 토큰 *대신* `#fff #000` 직접 사용 — D2 의 PopStatePill 등이 토큰 도입 전 작성. 의도된 hardcode 일 가능성 높음 (Memphis 가 검정/흰 고정), 그러나 일관성을 위해 `--canvas-card-border` (=`#000000`) 와 `--canvas-card-bg` (=`#fff`) 로 치환 가능.

→ **D-? 후보**: canvas/shell/widget-shell.tsx hex → token (XS).

---

## 4. Inline `style={{...}}` — 228 사이트

대부분 합법 사용:

- 동적 값 (`width: ${pct}%`, `transform: translate(...)`, `color: data.color`)
- D5 pop 토큰 wire (`background: 'var(--sidebar-bg)'`) — *CSS variable 을 inline 으로 주입할 수밖에 없는 합법 패턴*
- canvas 의 `--canvas-card-header-font` inline 주입 (theme switcher)

별도 patch 대상 없음. 다만 §3 의 hex inline color 패턴은 inline style 의 부분집합이라 그곳에서 처리.

---

## 5. Native control 잔재 (`<button>/<input>/<textarea>/<select>` outside primitives) — 79+36+3+17 = 135

`eslint.config.mjs:32-69` (`design-system/no-native-controls`) 가 src/**/*.{ts,tsx} 에서 error 처리하고 ignore 는 4개 경로:

| ignored path | 사유 (eslint 주석 인용) |
|---|---|
| `src/components/ui/**` | primitive 내부 (자기 자신) |
| `src/components/landing/**` | "marketing static page" — primitive 부적합 |
| `src/components/scheduler/**` | "scheduler nav chrome for which no current Button variant is a clean fit" |
| `src/app/*/(canvas-lab)/**` | mock lab — production 승격 시 strict |

### 5.1 카운트별

| 디렉토리 | 카운트 | 비고 |
|---|---|---|
| `components/scheduler/*` | 59 | ✅ ignored (eslint allow) — 별도 cleanup PR 검토 가치는 있음 |
| `app/[locale]/*` | 21 | 대부분 `(canvas-lab)` (ignored) — 일부는 production 라우트일 수 있어 확인 필요 |
| `components/landing/*` | 10 | ✅ ignored |
| `components/canvas/*` | 5 | 🟡 production canvas — widget-shell PopStatePill 등 |
| `components/translate-console.tsx` | 3 | 🟡 audit 필요 — eslint disable 주석 없으면 lint fail 가능 |
| `components/workspace-panel.tsx` | 2 | 🟡 audit 필요 |
| `components/invite-member-form.tsx` | 2 | 🟡 audit 필요 |
| `components/translate-viewer.tsx` | 1 | 🟡 audit 필요 |
| `components/reports/*` | 1 | 🟡 audit 필요 |
| `components/quant-analyzer.tsx` | 1 | 🟡 audit 필요 |

### 5.2 production 라우트 native control sample

`src/app/[locale]/(app)` 안 `<button>/<input>/...` — eslint allow path 아님이 라 `eslint-disable-next-line` 으로 명시 또는 primitive 치환 필요. PR-D8 가 read-only 라 검증만 — D-? 후속 PR.

→ **D-? 후보**: production 라우트 native control 명시 cleanup. ~10 사이트 추정 (medium PR).

---

## 6. 라우트별 디자인 일관성 통계

`text-mute-soft` (`#8a8693`, WCAG body 텍스트로 미달) 사용 빈도 (라우트 단위):

| 라우트 | text-mute-soft 사용 |
|---|---|
| `app/[locale]/(app)/dashboard` | 4 |
| `app/[locale]/(app)/desk` | 12 |
| `app/[locale]/(app)/quotes` | 8 |
| `app/[locale]/(app)/transcripts` | 5 |
| `app/[locale]/(app)/settings` | 6 |
| `components/scheduler/*` | 14 |
| `components/canvas/*` | 0 |
| `components/translate-console.tsx` | 19 |

→ a11y P0 (`docs/design-system-audit-2026-05-31.md` §0 결정적 약점 #2) 와 동일 finding. body 텍스트는 `--color-mute` (`#5b5965`, 6.2:1) 권장.

---

## 7. 결론 — 잔재의 정량 평가

| 등급 | 영역 | 사이트 수 | 후속 PR |
|---|---|---|---|
| 🔴 Critical (시각 격차) | 없음 | 0 | — |
| 🟠 High (일관성 위반) | sidebar/widget-shell hex outlier | ~16 | D11 |
| 🟡 Medium (cleanup) | translate-console rounded-[4px] / login·cookie hex box-shadow / production native control | ~25 | D10, D14 |
| 🟢 Low (deprecation 후보) | dead tokens (--color-amore-tint, --color-pacific* etc) / dead primitive (topbar.tsx) | ~7 | D9, D12 |

전체 코드 변경 분량 ≈ 50~80 라인. **5월 audit (350건) 대비 6분의 1 이하**로 축소.
