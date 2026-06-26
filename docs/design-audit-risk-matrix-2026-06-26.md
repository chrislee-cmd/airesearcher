# Design Audit Risk Matrix — 2026-06-26 (PR-D8 Phase 0)

> 토큰 / primitive / hardcode audit 의 발견을 위험 등급 + 우선순위로 정렬.
> 등급 기준: 🔴 Critical (시각 회귀/a11y 위반) · 🟠 High (일관성 큰 위반) · 🟡 Medium (cleanup) · 🟢 Low (deprecation·doc).

---

## 0. 합계

| 등급 | 건수 | 합계 size |
|---|---|---|
| 🔴 Critical | 0 | 0 |
| 🟠 High | 3 | S+M |
| 🟡 Medium | 5 | S+S+M+XS+XS |
| 🟢 Low | 6 | XS+XS+XS+S+M+S |

→ 머지 차단 수준 risk **0**. 모두 시각/문서 hygiene.

---

## 1. Matrix (전체)

| ID | 영역 | 위험 | 등급 | 우선순위 | 권장 PR | size |
|---|---|---|---|---|---|---|
| **R1** | sidebar.tsx hex 잔재 (`#fff #000 #555 #999`) D5 후속 | D5 톤이 일관되지 않음 — 추후 톤 조정 시 hex 인용 누락 위험 | 🟠 High | P1 | D11 sidebar hex → `--sidebar-*` 토큰 | S |
| **R2** | widget-shell.tsx PopStatePill hex inline | canvas pop 카드 chrome 의 일부가 토큰 우회 → 디자이너가 톤 조정 시 1곳 놓침 | 🟠 High | P1 | D11 canvas/shell hex → `--canvas-card-*` 토큰 | XS |
| **R3** | a11y — `text-mute-soft` body 텍스트 사용 (`#8a8693` = WCAG body AA 미달) | a11y 위반 위험 (실제 회귀 사례 없으나 P0) | 🟠 High | P1 | D14 a11y pass — text-mute-soft 사용처 audit + text-mute 로 분류 강제 | M |
| **R4** | login/cookie-consent/editorial.tsx `[box-shadow:0_1px_2px_...]` hex inline (3 site) | `--shadow-bento` 토큰 우회. 토큰 값 조정 시 누락 위험 | 🟡 Medium | P2 | D10 shadow 토큰 일관성 | S |
| **R5** | translate-console / translate-viewer `rounded-[4px]` 15 site | `rounded-xs` (4px) 토큰 1:1 매핑 가능 | 🟡 Medium | P2 | D10 일부 — `rounded-[4px]` → `rounded-xs` | S |
| **R6** | `components/translate-console.tsx`/`translate-viewer.tsx`/`workspace-panel.tsx`/`invite-member-form.tsx`/`quant-analyzer.tsx` 의 production native `<button>/<input>` (~10 site) | `eslint.config.mjs` no-native-controls 룰 위반. CI 머지 차단 가능 (이미 차단 중일 수 있음) | 🟡 Medium | P2 | D14 production native control 청소 (primitive 치환 또는 eslint-disable 명시) | M |
| **R7** | font-size lint hard-flip (`text-[Npx]`) — baseline 0 인데도 룰이 여전히 *soft* (eslint config 안 `# CI lint는 soft (§3.8 continue-on-error)` 주석) | 신규 텍스트 size hardcode 가 silent 통과 가능 | 🟡 Medium | P2 | D13 B-1 hard-flip — severity `warn → error` | XS |
| **R8** | `Slider` primitive 의 `[border-radius:2px]` outlier | 토큰 외 값. radius outlier 정책 미정 | 🟡 Medium | P3 | D9 토큰 청소 의사결정에 포함 | XS |
| **R9** | dead tokens: `--color-amore-tint`(0) / `--color-pacific*`(1) / `--color-gray-warm`(1) / `--radius-lg`(0) / pastel 5종 미사용 | 인지 부담. design-system catalog 노이즈 | 🟢 Low | P3 | D9 토큰 청소 | XS |
| **R10** | dead/orphan primitive: `src/components/topbar.tsx` (122 line, `(app)/layout.tsx` import 없음) | 122라인 dead code | 🟢 Low | P3 | D12 topbar 처분 | XS |
| **R11** | dead CSS classes: `.bento-card / .bento-surface / .bento-pill / .bento-tag` (`globals.css:154–201`, 사용 0) | 50줄 dead CSS | 🟢 Low | P3 | D12 globals.css 청소 | XS |
| **R12** | `docs/design-system-v2-draft.md` 6주째 검토 대기 | doc SSOT 모호 — PROJECT.md §9 의 외부 doc (`design-system.md`) 과 동기화 안 됨 | 🟢 Low | P2 | D15 v2 SSOT 화 의사결정 PR | S |
| **R13** | design-system 카탈로그 페이지 (`/design-system`) 가 super-admin gate — 일반 워커 접근 불가 | 신규 PR 작성자가 부품 카탈로그를 못 봄 → 잘못된 primitive 선택 위험 | 🟢 Low | P2 | D16 카탈로그 dev-build 노출 또는 PROJECT.md §9 에 스크린샷 embed | M |
| **R14** | "primitive 안에 canvas pop 미적용" 함정이 PROJECT.md §7 에 등록 안 됨 | 새 PR 이 canvas 안 primitive 사용 → 시각 충돌 발생 시 디버깅 어려움 | 🟢 Low | P3 | D17 PROJECT.md §7.X 함정 등록 | XS |

---

## 2. 우선순위 의사결정

### P1 (다음 sprint 머지 목표)
- **R1 (S)** + **R2 (XS)** + **R3 (M)** = sprint 1.5 일 분량

### P2 (이번 분기)
- **R4 (S)** + **R5 (S)** + **R6 (M)** + **R7 (XS)** + **R12 (S)** + **R13 (M)** = 분기 안 3~4 PR

### P3 (next planning cycle)
- **R8 / R9 / R10 / R11 / R14** = batch cleanup 1 PR (M)

---

## 3. 의존성 그래프

```
R1 ── independent
R2 ── independent
R3 ── independent (a11y workstream — design 결정 필요)
R4 ── D10 (R5 와 같은 PR 가능)
R5 ──┘
R6 ── independent
R7 ── R6 머지 후 가능 (잔재 0 보장 후 hard-flip)
R8 ──┐
R9 ──┼─ D9 (토큰 청소 단일 PR)
R11 ─┘
R10 ── D12 (R11 과 합칠 수 있음)
R12 ── independent (의사결정 PR — doc 만)
R13 ── R12 머지 후 (v2 doc 갱신과 함께)
R14 ── independent (PROJECT.md 단독)
```

---

## 4. 후속 PR 추천 (D9~D17)

상세 spec writer input 은 `docs/design-audit-followups-2026-06-26.md`. 여기는 한 줄 요약:

| PR | 타이틀 | size | risk 묶음 |
|---|---|---|---|
| **D9** | chore: 죽은 토큰 / dead CSS 청소 (`--color-amore-tint` 외) | S | R8, R9, R11 |
| **D10** | chore: `--shadow-bento` / `rounded-xs` 일관성 (login/cookie/editorial/translate) | S | R4, R5 |
| **D11** | chore: sidebar / canvas-shell hex → 토큰 (D5 후속) | S | R1, R2 |
| **D12** | chore: topbar.tsx 처분 + globals.css dead 50줄 제거 | XS | R10, R11 |
| **D13** | chore: text-[Npx] eslint hard-flip (baseline 0) | XS | R7 |
| **D14** | fix: a11y — text-mute-soft body 텍스트 정합 + production native control 청소 | M | R3, R6 |
| **D15** | doc: design-system v2 SSOT 승격 (의사결정 PR) | S | R12 |
| **D16** | feat: design-system 카탈로그 — pop 톤 demo 섹션 추가 + 워커 노출 정책 | M | R13 |
| **D17** | doc: PROJECT.md §7.X "canvas 안 primitive 사용 함정" 등록 | XS | R14 |

→ **권장 순서**: D9 → D10 → D11 → D12 → D13 → D17 → D15 → D14 → D16. 의존성 (R7 ← R6) 만 지키면 병렬 가능.
