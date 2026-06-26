# Design Audit — Follow-up PR Specs (D9~D17)

> PR-D8 audit (`docs/design-audit-{tokens,primitives,hardcodes,risk-matrix}-2026-06-26.md`) 의 발견을 후속 PR spec writer input 형태로 정리.
> 각 PR 은 jarvis 워크플로우 spec 파일 (`tasks/<id>.md`) 작성 시 *그대로 옮겨 쓸 수 있도록* 작성.
> **상태**: 제안. 실제 jarvis 스펙은 사용자 승인 후 spec writer 가 별도 작성.

---

## D9 — chore: dead 토큰 / dead CSS 청소 (S)

**risk**: R8 (Slider `[border-radius:2px]`) · R9 (dead tokens) · R11 (dead bento CSS)

### 변경 파일
- `src/app/globals.css`

### 작업
1. `--color-amore-tint` 제거 (0회 사용)
2. `--color-pacific` / `--color-pacific-bg` 정리:
   - 옵션 A: 제거 + `.bento-tag` 의 `background: var(--color-pacific-bg)` → `var(--color-paper-soft)` 치환 (사용 0이므로 영향 0)
   - 옵션 B: `--color-ink` alias 화
3. `--color-gray-warm` 제거 (사용 1 — `bg-gray-warm` 1회. 사용처 hex 로 대체 or `--color-mute` 로 치환 후 토큰 제거)
4. `--radius-lg` (32px) 보유 의사결정 — design-system 카탈로그 demo 외 사용 0:
   - 보유: 카탈로그에 "*언제 쓰는지 — 대형 컨테이너*" 사용 가이드 추가
   - 제거: 카탈로그에서도 제거
5. 6 파스텔 (lav/peach/mint/sun/sky/rose) — *사용 빈도 1~2* 인 것 검토. 디자이너 의사결정:
   - 보유: design-system v2-draft.md 에 "Palette retention rationale" 한 줄
   - 제거: 사용처 (highlighter `.hl.peach` 등) 의 fallback 색 확정 후 토큰 제거
6. dead bento CSS — `.bento-card / .bento-surface / .bento-pill / .bento-tag` (`globals.css:154–201`, 50라인) 제거 (사용 0)
7. `Slider` primitive `[border-radius:2px]` outlier 의사결정:
   - 보유: design-system 카탈로그에 outlier 사유 명시
   - 새 `--radius-2xs: 2px` 토큰 도입 + utility 등록

### 검증
- `pnpm lint` 0 errors
- `pnpm build` 통과
- `/design-system` 페이지 screenshot — 변경 후에도 모든 demo 정상
- grep `var(--color-amore-tint|--color-pacific|--color-gray-warm|--radius-lg|bento-card|bento-pill|bento-surface|bento-tag)` → 0

### PR size
- ~50 라인 (toll mostly globals.css)

---

## D10 — chore: `--shadow-bento` / `rounded-xs` 일관성 (S)

**risk**: R4 (hex box-shadow inline) · R5 (`rounded-[4px]`)

### 변경 파일
- `src/app/[locale]/login/page.tsx`
- `src/components/cookie-consent-banner.tsx`
- `src/components/editorial.tsx`
- `src/components/translate-console.tsx`
- `src/components/translate-viewer.tsx`

### 작업
1. login/cookie/editorial — `[box-shadow:0_1px_2px_rgba(29,27,32,.04),0_8px_24px_rgba(29,27,32,.06)]` → `[box-shadow:var(--shadow-bento)]`
   - `cookie-consent-banner.tsx` 의 `0.08` (vs 표준 `0.06`) 알파 차이는 디자이너 확인 — 의도면 별도 토큰 `--shadow-bento-strong: 0 1px 2px ..., 0 8px 24px rgba(29,27,32,.08)` 도입 후 적용
2. translate-console / translate-viewer 15곳 — `rounded-[4px]` → `rounded-xs`

### 검증
- `pnpm lint`/`pnpm typecheck` 0 errors
- preview URL 에서 login/cookie-consent banner/translate 화면 시각 회귀 0
- grep `\[box-shadow:0_1px_2px_rgba\(29,27,32` → 0 (또는 1 — `cookie` strong 만)
- grep `rounded-\[4px\]` → 0

### PR size
- ~25 라인

---

## D11 — chore: sidebar / canvas-shell hex → 토큰 (D5 후속) (S)

**risk**: R1, R2

### 변경 파일
- `src/components/sidebar.tsx`
- `src/components/canvas/shell/widget-shell.tsx`

### 작업
1. sidebar.tsx 8 hex (`'#fff' '#000' '#555' '#999'`) →
   - `#fff` → `var(--sidebar-nav-bg)` 또는 `var(--sidebar-active-text)` (활성 toggle 인 경우)
   - `#000` → `var(--sidebar-border)` (값 동일)
   - `#555` → `var(--color-mute)` (값 근사 — design 확인)
   - `#999` → `var(--color-mute-soft)` (값 근사)
2. canvas/shell/widget-shell.tsx 6 hex (PopStatePill `'#fff' '#000'`) →
   - `--canvas-card-bg` / `--canvas-card-border` 사용
   - inline border-width `'2px solid #000'` → `'2px solid var(--canvas-card-border)'`
   - inline shadow `'2px 2px 0 #000'` → token 후보 `--memphis-shadow-xs` 사용 가능 (D5 토큰)
3. `PopStatePill` 함수 → `<Pill variant="pop">` primitive 화 (선택 — D-? 후보로 분리 가능)

### 검증
- 사이드바 시각 회귀 0 (active/hover/collapsed 상태 모두 확인)
- `/canvas` 라우트 widget state pill 시각 회귀 0
- grep `'#fff'\|'#000'\|'#555'\|'#999'` in target files → 0

### PR size
- ~30 라인

---

## D12 — chore: topbar.tsx 처분 + dead 50라인 (XS)

**risk**: R10, R11 (R11 은 D9 와 중복 — D9 와 합쳐도 OK)

### 변경 파일
- `src/components/topbar.tsx` (제거)
- `src/app/globals.css` (dead bento CSS 50라인 제거 — D9 와 중복 가능)
- `src/app/[locale]/(canvas-lab)/canvas/canvas-mock.tsx` 등 topbar 사용처 확인 (실제 import 검증 후)

### 작업
1. `grep -rn "from.*topbar\|import.*Topbar" src/` 재확인 — 사용 0이면 file 제거
2. (사용처 있으면) 해당 사용처도 마이그/제거
3. globals.css `.bento-card/.bento-surface/.bento-pill/.bento-tag` 블록 제거 (D9 와 묶을 수 있음)

### 검증
- `pnpm build` 통과
- preview 모든 라우트 정상

### PR size
- ~150 라인 삭제 (topbar.tsx 122 + globals 28)

---

## D13 — chore: text-[Npx] eslint hard-flip (XS)

**risk**: R7

### 변경 파일
- `eslint.config.mjs`
- (CI workflow 파일 — `.github/workflows/*.yml` 에서 `continue-on-error: true` 가 lint job 에 있다면 제거. lint hard-block 화)

### 작업
1. `eslint.config.mjs:106-118` 의 두 `Literal[value=/\btext-\[\d+/]` / `TemplateElement` 룰 — 이미 `error` severity 면 그대로, soft 이면 hard 로 승격
2. CI `Lint` job 의 `continue-on-error: true` 제거 (해당 룰 한정)
3. `grep -rEn 'text-\[[0-9]+(?:\.[0-9]+)?px\]' src/` 0 재확인 (baseline 0)
4. PROJECT.md §3.8 표 업데이트 — text-[Npx] 차단 hard 로 표기

### 검증
- CI green
- 일부러 test commit 으로 `<div className="text-[12px]" />` 한 줄 추가 → lint error 확인 → revert

### PR size
- ~5 라인 (eslint config + workflow yaml)

---

## D14 — fix: a11y text-mute-soft + production native control 청소 (M)

**risk**: R3 (a11y), R6 (native control 잔재)

### 변경 파일
- ~15 파일 추정 (사용처별)

### 작업
1. **a11y workstream**:
   - `text-mute-soft` body 텍스트로 쓰인 곳을 audit (라우트별 통계 — `docs/design-audit-hardcodes-2026-06-26.md` §6)
   - body 텍스트 → `text-mute` 로 승격 (대비비 6.2:1)
   - eyebrow/caption 만 `text-mute-soft` 보존
   - design-system 카탈로그 에 사용 가이드 명문화
2. **production native control 청소**:
   - `src/components/translate-console.tsx` 3 사이트
   - `src/components/translate-viewer.tsx` 1 사이트
   - `src/components/workspace-panel.tsx` 2 사이트
   - `src/components/invite-member-form.tsx` 2 사이트
   - `src/components/reports/*` 1 사이트
   - `src/components/quant-analyzer.tsx` 1 사이트
   - `src/app/[locale]/(app)/*` production 라우트 안 native control sample
   - 각각 primitive (`<Button>/<Input>/<Textarea>/<Select>`) 로 치환 OR `eslint-disable-next-line react/forbid-elements -- <reason>` 명시

### 검증
- `pnpm lint` 0 errors (특히 `react/forbid-elements`)
- preview 모든 변경 라우트 시각 회귀 0
- Lighthouse a11y score 변화 확인 (감소 X)

### PR size
- ~150 라인

---

## D15 — doc: design-system v2-draft → SSOT 승격 (S)

**risk**: R12

### 변경 파일
- `docs/design-system-v2-draft.md` → `docs/design-system.md` rename 또는 PROJECT.md §9 참조 경로 변경
- `PROJECT.md` §9 의 외부 doc 참조 (`/Users/churryboy/AI-researcher/design-system.md`) 갱신
- (외부 doc 도 동시 갱신 — 별도 동작)

### 작업
1. 사용자/디자이너 검토 (의사결정 PR)
2. v2-draft 내용을 *현재 코드 truth* 와 마지막 동기화 (audit 결과 반영)
3. PROJECT.md §9 / §10 의 doc 위계 표 갱신

### 검증
- doc 내용만 — 빌드 영향 0
- PROJECT.md 의 cross-reference 깨짐 없음

### PR size
- ~500 라인 doc (대부분 기존 draft 내용)

---

## D16 — feat: design-system 카탈로그 pop 톤 demo + 워커 노출 (M)

**risk**: R13

### 변경 파일
- `src/app/[locale]/(app)/design-system/page.tsx`
- `src/app/[locale]/(app)/design-system/demos.tsx`
- (선택) `src/app/[locale]/(app)/design-system/pop-demo.tsx` 신규

### 작업
1. **pop 톤 demo 섹션 추가**:
   - "Canvas pop tokens" 섹션 — 23개 `--canvas-*` 토큰 시각 카탈로그
   - "Shell pop tokens" 섹션 — 14개 `--sidebar-*` `--memphis-*` 토큰 카탈로그
   - "Memphis pattern" 라이브 demo — `data-canvas-body` 안 button/input 시각
2. **워커 노출 정책**:
   - 옵션 A: super-admin gate 유지, 대신 PROJECT.md §9 에 카탈로그 스크린샷 embed (linkable)
   - 옵션 B: 카탈로그를 일반 로그인 사용자 모두에게 노출 (단 navigation 에서는 숨김)
   - 옵션 C: dev-build 한정 노출 (`process.env.NODE_ENV === 'development'`)
3. **누락 부품 표시** (`docs/design-audit-primitives-2026-06-26.md` §2) — Tabs/Tooltip/Switch/Radio/Avatar/Pill 등 *없음* 명시

### 검증
- `/design-system` 직접 접근 → pop demo 섹션 시각 확인
- 정책 옵션별로 노출 확인

### PR size
- ~250 라인

---

## D17 — doc: PROJECT.md §7.X "canvas 안 primitive 사용 함정" (XS)

**risk**: R14

### 변경 파일
- `PROJECT.md` §7 함정 섹션

### 작업
- §7.14 (또는 다음 번호) 신규 등록:
  > **§7.14 canvas 본문 안에 bento primitive 사용 시 시각 충돌**
  >
  > `[data-canvas-body]` scoped CSS rule 은 native `<button>/<input>/<textarea>/<select>` 만 잡습니다. primitive (`<Button>/<Input>` 등) 가 canvas 위젯 body 안에 들어가면 *Memphis pop 톤 안에 bento 톤 (1px border, 14px radius, no shadow) 이 섞이는 시각 충돌* 발생.
  >
  > **회피**: canvas 위젯은 native 요소 또는 (D-? 머지 후) `<PopButton>/<PopInput>` 사용. primitive 가 필요한 경우 `data-canvas-body` 밖에 두거나 새 variant prop (`<Button tone="pop">`) 도입 후 적용.

### 검증
- PROJECT.md 렌더링 확인 — markdown 깨짐 없음

### PR size
- ~15 라인

---

## 의존성 그래프 (전체)

```
D9 ──┐
D11 ─┤── independent (병렬 가능)
D17 ─┤
D15 ─┘

D10 ── independent

D12 ── D9 와 병합 가능

D6 (R6) ──── D13 (R7)
            (잔재 0 → hard-flip)

D14 ── D6 part 와 동일 (합칠 수 있음)

D16 ── D15 머지 후 (doc SSOT 정합)
```

---

## 예상 일정 (1 워커 기준)

| 주차 | PR |
|---|---|
| 주 1 | D9 + D10 + D11 (병렬 머지) |
| 주 2 | D12 + D13 + D17 |
| 주 3 | D14 |
| 주 4 | D15 (의사결정 — 디자이너/PM 검토 dependent) |
| 주 5 | D16 |

→ 5주 분량 / 9 PR. 합계 코드 변경 ~1000 라인 (대부분 doc 과 dead code 삭제).
