# Primitive Audit — 2026-06-26 (PR-D8 Phase 0)

> `src/components/ui/*` 22개 컴포넌트의 시각·variant·pop 톤 정합 점검. canvas pop (Memphis) 톤이 primitive 에 *적용되어야 하는지* 는 별도 의사결정 (D-? 라우트별 본문 pop 통일과 함께).
> **상태**: 진단만. 시각/패치 없음.

---

## 0. TL;DR

- primitive 22개 중 **0개가 Memphis pop 톤 (3px 검은 border + offset shadow + 노랑/핑크 액센트) 적용**. 모든 primitive 는 **bento 톤** (1px `border-line`, `rounded-sm` (14px), warm cream + amore-purple accent) 으로 통일.
- 결정 사항: **이 상태는 의도된 분리** — pop 톤은 `data-canvas-body` scope 안 (canvas 본문) + 사이드바/topbar chrome 에만 적용. primitive 가 직접 pop 으로 바뀌면 dashboard / desk / quotes 등 모든 라우트 본문이 노랑이 됨 (의도 X).
- **그러나 primitive 안에 한국어 주석 4건이 "TODO 후속 pop 적용"** 같은 약속을 남기지 않았는지 점검 결과: **없음**. primitive 들은 bento 가 자기 톤이라는 전제로 설계됨.
- 진짜 issue: `ChromeButton` (4px chrome) vs `Button` (14px capsule) 의 *역할 분담* 이 코드 안 주석에만 있고 시각 카탈로그가 없어 새 PR 들이 잘못된 primitive 를 고르는 경우가 누적될 위험. design-system 카탈로그 페이지가 이 갭을 1차로 매웠으나 super-admin gate 라 일반 워커는 접근 불가.

---

## 1. Primitive별 시각 + 정합 판정

각 primitive 의 (a) 토큰 사용, (b) variant/size, (c) 톤 판정 (bento / pop / 무관).

### 1.1 Action primitives

| Primitive | 파일 | radius | border | shadow | hover | 톤 | 비고 |
|---|---|---|---|---|---|---|---|
| `Button` | `ui/button.tsx` | `rounded-sm` (14px) / `rounded-full` (cta) | `border-ink/-line/-warning/-transparent` | none, cta 만 `--shadow-bento` hover | color flip | **bento** | 6 variants × 5 sizes. `cta` 는 pill + hover shadow. focus = border-amore (a11y ring 별도) |
| `ChromeButton` | `ui/chrome-button.tsx` | `rounded-xs` (4px) | `border-line/-amore` | none | border-color + amore | **bento** | "in-row chrome" 의도 (workspace/translate). 3 variants × 4 sizes. PR #230 회귀 (BASE 색 없음) 원인 코드 주석 보존 |
| `IconButton` | `ui/icon-button.tsx` | (variant=bordered 만 `rounded-xs`) | (bordered 만) | none | text color shift | **bento** | aria-label 필수 (a11y 강제 by type). 4 variants × 4 sizes |

판정: 3개 모두 일관된 bento 톤. **Memphis 적용 X — 의도된 선택**. canvas/사이드바는 pop, 본문은 bento.

### 1.2 Form primitives

| Primitive | 파일 | radius | tone | 톤 | 비고 |
|---|---|---|---|---|---|
| `Input` | `ui/input.tsx` | `rounded-sm` | border-line / focus border-amore / error border-warning | **bento** | label/helper/error + size sm/md + left/right slot. 의도된 form-style |
| `ChromeInput` | `ui/chrome-input.tsx` | `rounded-xs` (4px) | 동일 패턴, label/error 없음 | **bento** | in-row name/rename (workspace/translate). label 일부러 제외 — caller 가 라벨 컨텍스트 소유 |
| `ChipInput` | `ui/chip-input.tsx` | (no border) | bg-transparent | **bento** | 칩 컨테이너 안 extender (1 site = desk keyword). 부모가 focus-within 프레임 소유 |
| `Textarea` | `ui/textarea.tsx` | `rounded-sm` | Input 과 동일 contract + resize-y | **bento** | rows prop |
| `Select` | `ui/select.tsx` | `rounded-sm` | appearance-none + 자체 chevron | **bento** | placeholder/options/leftSlot. native `<select>` 위 |
| `Checkbox` | `ui/checkbox.tsx` | (native) | `accent-amore` 자동 | **bento** | sm/md size. UI 없음 — wrap with `<label>` |
| `Label` | `ui/label.tsx` | (text only) | uppercase tracking-[0.22em] text-mute-soft | **bento** | Input/Textarea/Select 내부 사용. 직접 import 드물어야 |
| `Slider` | `ui/slider.tsx` | `[border-radius:2px]` | accent-amore | **bento** | 12 line primitive. hardcoded 2px (outlier — token 외) |

판정: 8개 모두 bento. `Slider` 가 `[border-radius:2px]` outlier 사용 — `--radius-xs` (4px) 와 의도 다름 (track 자체가 얇은 1px 라 2px 가 합리). **lint allow** (4/14/24/999/9999 만 차단).

### 1.3 Overlay primitives

| Primitive | 파일 | radius | shadow | 톤 | 비고 |
|---|---|---|---|---|---|
| `Modal` | `ui/modal.tsx` | `rounded-sm` | `[box-shadow:var(--shadow-bento)]` | **bento** | sm/md/lg/xl 4 size. Esc/backdrop/focus restore/scroll-lock 완비. z-modal (50). title/description/footer 슬롯 |
| `DropdownMenu` | `ui/dropdown-menu.tsx` | `rounded-sm` | none | **bento** | headless. ↑↓ Enter Esc 키보드 nav. align/side/minWidth/label. **z-30** hardcode (← z-token 미사용 outlier) |
| `DownloadMenu` | `ui/download-menu.tsx` | (uses DropdownMenu) | none | **bento** | ExportFormat 별 url/blob/action. 1개일 때 plain button fallback |
| `ShareMenu` | `ui/share-menu.tsx` | (uses DropdownMenu) | none | **bento** | Google Docs/Sheets/Notion. 인증 끊긴 경우 connect URL redirect |

판정: 4개 bento. `DropdownMenu` 의 `z-30` 은 토큰 외 outlier (z-fab 40 미만, 일부러 낮춤). lint allow 패턴이지만 catalog 페이지에 사유 명시 권장.

### 1.4 Display / state primitives

| Primitive | 파일 | radius | 톤 | 비고 |
|---|---|---|---|---|
| `Skeleton` | `ui/skeleton.tsx` | text=xs, block=sm, circle=full | **bento** | animate-pulse bg-line-soft. 3 variant (text/block/circle) |
| `EmptyState` | `ui/empty-state.tsx` | `rounded-sm` | **bento** | tone=default(solid)/subtle(dashed border). icon/title/desc/action |
| `BrandLoader` | `ui/brand-loader.tsx` | (img) | **bento** | brand-sway 애니메이션 + 옵션 label |
| `JobProgress` | `ui/job-progress.tsx` | `rounded-sm` (panel) + `rounded-full` (bar) | **bento** | indeterminate/determinate. tone=default(amore)/error(warning). 자체 cancel 버튼 (chrome 톤 inline — primitive 아님) |
| `FileDropZone` | `ui/file-drop-zone.tsx` | `rounded-sm` | **bento** | drag/drop + click picker. dragOver 시 border-ink 로 solid 전환. onDropRaw 로 워크스페이스 artifact 지원 |
| `FeaturePage` | `ui/feature-page.tsx` | (layout only) | **bento** | 페이지 헤더 + body wrapper. text-3xl title + bottom border |

판정: 6개 모두 bento. `JobProgress` 안에 inline chrome 버튼 (cancel) 이 있어 `ChromeButton` 으로 추출 가능 (D-? 후보).

---

## 2. 누락 primitive (현재 ad-hoc 패턴)

design-system 카탈로그 페이지가 보유한 부품이 22개. 실제 코드에서 *반복되지만 primitive 가 없는* 패턴:

| 패턴 | 사이트 수 | 현재 ad-hoc 구현 | 후보 primitive |
|---|---|---|---|
| Pill / Badge / Tag (Memphis state pill) | canvas/widget-shell `PopStatePill` + 약 10여 곳 | hex hardcode inline style (`background:#fff`, `border:'2px solid #000'`, etc) | `<Pill variant=pop/bento>` |
| Tooltip | 미확인 (라이브러리 의존?) | 라우트별 ad-hoc | `<Tooltip>` |
| Tabs | desk / quotes / canvas-mock 등 | 라우트별 ad-hoc | `<Tabs>` |
| Switch | 미확인 (Checkbox 대용으로 처리?) | — | `<Switch>` 도입 검토 |
| Radio | 미확인 | — | `<Radio>` |
| Avatar | sidebar-account 등 | inline | `<Avatar>` |
| Toast | `ToastProvider` 가 자체 구현 | — | provider 안에 있어 primitive 화 비효율 |
| Spinner | BrandLoader 외에 일반 spinner | — | `<Spinner size>` |

→ design-system 카탈로그가 catalog 인 만큼 이 누락 부품들이 한 곳에서 보이지 않음. D-? 카탈로그 갱신 PR 에서 *누락 목록* 도 표시 (gap 시각화).

---

## 3. Canvas pop primitive 미적용 — 의도 vs 잔재

`/canvas` 라우트는 `widget-shell.tsx` 안에서 `data-canvas-body` div 를 두고, globals.css 의 scoped CSS rule (`[data-canvas-body] button { ... }`) 로 *모든 native `<button>/<input>/<textarea>/<select>` 를 Memphis 화*. 즉:

- canvas 본문의 button/input 은 *primitive 를 안 거치고도 자동으로 Memphis* 가 됨 (CSS rule 이 native 요소를 잡음).
- **primitive (`<Button>` 등) 가 canvas 안에 들어가면**: scoped CSS 가 native `<button>` 만 잡으므로 primitive 의 bento `border-line rounded-sm` 가 살아남아 *Memphis 안에 bento 가 섞이는 시각 충돌* 발생 가능. 현재 canvas 안 primitive 사용은 거의 0 (`widget-shell.tsx`/`canvas-toolbar.tsx` 모두 native + scoped CSS 또는 inline style 로 처리) — issue 미발생.

→ **위험도 Low**. 단 canvas 위젯 안에 primitive 를 끌어다 쓰는 PR 이 생기면 회귀 가능. PROJECT.md §9 "Primitive 의 BASE 클래스에 색을 넣지 마세요" 와 동급의 함정 — 별도 §7.X 함정 등록 후보.

---

## 4. Memphis primitive 도입 시나리오 (별도 PR 결정)

만약 사용자 의사결정이 "본문 라우트도 단계적으로 pop 톤" 으로 기운다면:

- **옵션 A — primitive 에 `tone="pop"` prop 추가**: `<Button tone="pop">` 등. 코드 변경 큼. 라우트별 점진 적용 가능.
- **옵션 B — scoped CSS rule 확장**: 새로운 `[data-pop-body]` selector 를 추가해 적용 영역만 raw `<button>` 사용. primitive 우회.
- **옵션 C — pop 톤 전용 primitive 추가**: `<PopButton>/<PopInput>/<PopPill>` 등 별도 컴포넌트. canvas + 다른 pop 라우트가 공유.

→ **이 audit 의 권장**: 의사결정 전까지 옵션 *결정하지 말 것*. PR-D8 의 결과로 사용자가 *"본문에 pop 적용할지/말지"* 를 명시한 후 D-? 라우트별 통일 PR 의 spec 에 반영.

---

## 5. 정합 판정 — 종합

| 영역 | 정합 | 비고 |
|---|---|---|
| primitive ↔ bento 톤 정합 | ✅ 22/22 | 모두 bento 톤. canvas pop 은 scope 분리. |
| primitive ↔ pop 톤 정합 | ⏸ 적용 없음 | 의사결정 대기 (§4) |
| `react/forbid-elements` 강제 | ✅ scheduler/landing/canvas-lab 예외 외 hard-block | `eslint.config.mjs:32-69` |
| `no-restricted-syntax` 강제 (radius/z-index) | ✅ hard-block | `eslint.config.mjs:79-122` |
| `text-[Npx]` 강제 | 🟡 baseline 0 이지만 hard-block 전환 안 됨 | D-? 후보 |
| design-system 카탈로그 완전성 | 🟡 22 primitive 모두 demo 있음 / pop 영역은 없음 | D-? 카탈로그 갱신 후보 |
