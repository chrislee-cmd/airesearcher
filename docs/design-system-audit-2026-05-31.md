# Design System Audit — 2026-05-31

> **목적**: `docs/design-system-v2-draft.md` (PR #188) 의 §11 audit 체크리스트를 실제 코드 (`main @ 412b609`) 에 실행한 진단 리포트.
> **상태**: 진단만. **코드 변경 0, production 영향 0**.
> 이 doc 은 후속 patch PR 들의 근거 자료로 사용.

---

## 0. TL;DR

- 디자인 시스템 **건강도 = 중상위 (B+)**. 토큰 일관성·모션 일관성·i18n·톤 분리 모두 우수.
- 결정적 약점 **3가지**:
  1. 🔴 **A11y — focus-visible 0 coverage** (전체 코드 0건). WCAG 위반 위험.
  2. 🔴 **WCAG 대비비 — `text-mute-soft` 258곳 사용 중 일부는 body 텍스트로 사용** → 3.5:1 (AA 미달).
  3. 🟠 **공유 primitive 부재** — Button (181건 inline) / Input·Textarea·Select (85건 native) / Modal (8건 ad-hoc) 컴포넌트 없음.
- 액션 가능한 위반 사례 **총 약 350건** (개발 1.5~2주 분량으로 추산).

---

## 1. 자동 grep 결과 (수치)

### 1.1 컬러 — 하드코딩 (Hex / RGB)

| 패턴 | 전체 건수 | landing 안 (정상) | 코드 (검토 대상) | 비고 |
|---|---|---|---|---|
| `#XXXXXX` hex | 107 | 53 | **54** | 검토 필요 |
| `rgb()/rgba()` | 20 | 11 | **9** | 검토 필요 |
| Tailwind 비표준 컬러 (`text-red-500` 등) | **0** | — | 0 | ✅ |

**코드 (54 + 9 = 63건) 최다 위반:**

| 파일 | hex | rgba | 평가 |
|---|---|---|---|
| `lib/reports/prompts/_shared.ts` | 12 | 0 | LLM 프롬프트 안 색 표기. 토큰 무관 — **허용** |
| `lib/scheduler/project-colors.ts` | 9 | 0 | 프로젝트 라벨 색 회전 팔레트 — **토큰화 권장** |
| `components/desk-analytics-panel.tsx` | 8 | 0 | 차트 색 — am/pm-accent 토큰 활용 가능 |
| `components/ui/share-menu.tsx` | 4 | 0 | Google/Notion 브랜드 색 — **허용** (외부 브랜드 컬러) |
| `components/voice-concierge/highlight-overlay.tsx` | 0 | 2 | spotlight box-shadow — 토큰화 검토 |
| `components/translate-console.tsx` | 3 | 0 | 검토 필요 |
| `components/translate-viewer.tsx` | 2 | 0 | 검토 필요 |
| `components/sidebar.tsx` | 2 | 0 | 검토 필요 |
| `app/api/translate/recordings/[id]/download/route.ts` | 1 | 0 | 응답 헤더용 색? — 검토 필요 |
| 기타 1~2건 파일 | 각 1~2 | 0 | spot check |

**판정**: 코드 측 하드코딩 중 **약 30% (≈18건) 는 권장 패치**, 나머지 70% 는 외부 브랜드 / LLM 프롬프트 / 차트 데이터 색 (허용).

---

### 1.2 Radius — 임의 값 분포

```
198× [border-radius:14px]    ← 표준 (in-app)
 27× [border-radius:4px]     ← Editorial doc 잔재
 12× [border-radius:9999px]  ← 표준 (pill)
  9× [border-radius:2px]     ← 비표준
  8× [border-radius:3px]     ← 비표준
  3× [border-radius:8px]     ← 비표준
  3× [border-radius:10px]    ← 비표준
  2× [border-radius:24px]    ← 표준 (bento card, 랜딩만)
  1× [border-radius:999px]   ← typo (9999 의 오기)
─────────────────────────────
263× 전체, 51건이 비표준 (19%)
```

**비표준 51건 분포** (대표 위반 위치):
- `projects-view.tsx:203` — `[border-radius:3px]` (작은 토글)
- `quant-analyzer.tsx:290` — `[border-radius:2px]` (작은 라벨)
- `credits-usage-predictor.tsx:170,208` — `[border-radius:2px]` (얇은 인디케이터)
- `recruiting-brief.tsx` 4곳 — `[border-radius:3px]` (form 작은 input)
- `credits-bundles.tsx:188,211` — `[border-radius:2px]` (badge)
- `moderator-services-carousel.tsx:134,223` — `[border-radius:2px]`
- `video-analyzer.tsx:99,342` — `[border-radius:3/8px]` (code/textarea)
- `credits-status-banner.tsx:36` — `[border-radius:4px]` (banner)
- `workspace-panel.tsx:482,488,521` — `[border-radius:4px]` (input)

**Tailwind 표준 `rounded-*` 사용**: 단 8건 (`rounded-full` 7, `rounded-sm` 1). 거의 안 씀.

**inline `style={{ borderRadius }}`**: 57건 — 대부분 동적 값 (애니메이션, computed) — 검토 대상에서 제외.

**판정**:
- 표준 (`14/24/9999`) 사용률 ≈ 81%
- 비표준 19% 중 **`4px` 27건은 Editorial 잔재**, 의도 검토 필요 (보존? `14` 통일?)
- **`2/3/8/10/999` 24건은 명백한 정리 대상**

---

### 1.3 Shadow

```
5× shadow-[…]  (전체)
  2× --shadow-bento 토큰 그대로 사용 ✅
  3× ad-hoc (각 다른 값)
1× inline boxShadow (voice-concierge highlight — spotlight 기법, 의도된 거대 shadow)
0× shadow-sm/md/lg 등 Tailwind named
```

**판정**: 거의 완벽. **ad-hoc 3건만 토큰 통일하면 끝**.

---

### 1.4 모션 / Transition

```
86× transition-* 사용
  82× transition-colors  (95%)
   5× transition-transform
   3× transition-all (← 권장하지 않음)
   1× transition-opacity

Duration:
  82× duration-[120ms]   (95% — 표준)
   1× duration-[240ms]
   1× duration-[200ms]
   1× duration-[180ms]
   1× duration-[160ms]
```

**판정**: ✅ **모션 일관성 최상**. 95% 가 단일 timing/property. 권장 미세조정만.

---

### 1.5 공유 Primitive — 부재 / 사용 현황

| 카테고리 | 컴포넌트 | 존재? | 사용처 | 미사용 inline 패턴 |
|---|---|---|---|---|
| Form | `<Button>` | ❌ | 0 | **`<button>` 181건** (다른 패턴 5종) |
| Form | `<Input>` | ❌ | 0 | `<input>` 다수 |
| Form | `<Textarea>` | ❌ | 0 | `<textarea>` 다수 |
| Form | `<Select>` | ❌ | 0 | `<select>` 다수 |
| Form | `<Checkbox>/<Radio>/<Switch>` | ❌ | 0 | 산발적 |
| Form 합계 | `<input/textarea/select>` | — | — | **85건** |
| Overlay | `<Modal/Dialog>` | ❌ | 0 | **`fixed inset-0` 8건** ad-hoc |
| Overlay | `<Tooltip>/<Popover>` | ❌ | 0 | native `title` 만 |
| Feedback | `<Skeleton>` | ❌ | 0 | `animate-pulse` 분산 |
| Feedback | `<Spinner>` | ❌ (MochiLoader 만) | — | — |
| ✅ 존재 | `<DropdownMenu>` | ✅ | 3 | — |
| ✅ 존재 | `<EmptyState>` | ✅ | **3** ⚠️ | 16건 추정 ad-hoc empty |
| ✅ 존재 | `<FileDropZone>` | ✅ | **7** ⚠️ | 4건 native `<input type="file">` |
| ✅ 존재 | `<JobProgress>` | ✅ | 10 | — |
| ✅ 존재 | `<FeaturePage>` | ✅ | **5/23** 🚨 | 18 pages custom header |
| ✅ 존재 | `<MochiLoader>` | ✅ | 3 | `animate-spin/pulse` 8 |
| ✅ 존재 | `<DownloadMenu>/<ShareMenu>` | ✅ | 정상 | — |

**판정**: 가장 큰 단일 부채. **Button/Input 만 도입해도 약 266건의 inline 코드가 정리됨**.

---

### 1.6 페이지 일관성 — FeaturePage 사용률

| 항목 | 값 |
|---|---|
| `(app)/*` 라우트 전체 | 23 pages |
| FeaturePage 헤더 사용 | **5 pages** |
| custom 헤더 (위반) | **18 pages** |
| 사용률 | **22%** 🚨 |

**FeaturePage 미사용 페이지**:
- affinity-bubble, settings, transcripts, desk, moderator, projects, scheduler, **dashboard**, members, survey, keywords, analyzer, **credits**, recruiting, reports, projects/[id], admin/payments, admin/api-usage

대부분 같은 패턴 (eyebrow + accent line + H1 + hairline + subtitle) 을 inline 으로 반복. dashboard 가 대표적 — 30줄 inline 헤더가 FeaturePage 한 줄로 줄어들 수 있음.

---

### 1.7 A11y — 🔴 **CRITICAL**

| 점검 | 결과 |
|---|---|
| `focus-visible:` 클래스 사용 | **0 곳** 🚨 |
| `focus:outline-none` (focus alternative 없이) | 3 곳 |
| 주로 의존하는 패턴 | `focus:border-ink-2` (시각만, WCAG visible-focus 명시 X) |
| 키보드 Esc 닫힘 | DropdownMenu / Modal 일부만 |

**평가**:
- focus-visible 0 coverage 는 키보드 사용자 차별.
- `focus:border-ink-2` 는 색 대비 변화로 focus 를 표시하지만, ring 같은 명시적 표시 권장.
- WCAG 2.4.7 (Focus Visible) 위반 가능성 높음.

---

### 1.8 WCAG 대비비 — 🔴 **검토 필요**

| 색 조합 | 대비비 | 판정 |
|---|---|---|
| `text-ink-2` (`#2a262f`) on `bg-paper` (`#fbf7f2`) | ~13:1 | ✅ AAA |
| `text-mute` (`#5b5965`) on `bg-paper` | ~6.5:1 | ✅ AA |
| `text-mute-soft` (`#8a8693`) on `bg-paper` | **~3.5:1** | ⚠️ AA 미달 (body), AA OK (large/icon) |
| `text-amore` (`#a06fda`) on `bg-paper` | ~3.0:1 | ⚠️ AA 미달 (body) |

**`text-mute-soft` 사용 현황**: 258건. 대부분 11~12px 작은 메타·캡션 (대비 룰 완화 적용 가능) 이지만, **본문 (12.5px+) 으로 사용한 경우는 보강 필요**.

**`text-amore` 사용 현황**: 99건. 대부분 UPPERCASE 11px 라벨 (작은 텍스트라 OK) — body text 로 쓰인 경우 없음을 확인했지만 정밀 검토 필요.

---

### 1.9 아이콘 시스템 — **🟠 surprise**

| 출처 | 사용 |
|---|---|
| `lucide-react` import | **0** 🚨 (draft 가 잘못 가정) |
| `react-icons` / `@heroicons` | 0 ✅ |
| 인라인 `<svg>` | 16개 / 10 파일 |
| 이모지 (UI 안) | 다수 (랜딩 + voice + sidebar) |

**판정**: 아이콘 시스템 **자체 없음**. 인라인 SVG 와 이모지가 ad-hoc 으로 섞여 있음. **draft 의 §9.1 (Lucide 통일) 은 사실 미반영 — doc 수정 필요**.

---

### 1.10 반응형 / 모바일

| breakpoint | 사용 수 |
|---|---|
| `sm:` (640px+) | 33 |
| `md:` (768px+) | 13 |
| `lg:` (1024px+) | 6 |
| `xl:` (1280px+) | 1 |

**Fixed-width 잠재 문제 (>=760px 강제 가로폭)**:
- `recruiting-brief.tsx` 테이블 `min-w-[760px]`
- `interview-analyzer.tsx` 테이블 `min-w-[800px]`
- → 모바일에서 가로 스크롤 발생

**판정**: 데스크탑 우선. 모바일 전략 부재 — 별도 결정 필요 (가로 스크롤 vs 카드 collapse vs hide).

---

### 1.11 톤 혼재 (in-app + landing bento)

| 점검 | 결과 |
|---|---|
| bento 클래스 (`bento-card/surface/pill`) 가 in-app 코드에 누출 | **0** ✅ |
| `landing.css` 가 landing 외부에서 import | **0** ✅ |

**판정**: ✅ **완벽**. 두 시스템 경계 잘 지켜짐.

---

### 1.12 i18n

| 점검 | 결과 |
|---|---|
| `useTranslations` 사용 파일 | 40 |
| 하드코딩 한글 (`"[가-힣]{3,}"` 패턴) | **0** ✅ |

**판정**: ✅ **i18n 누락 없음**.

---

## 2. 점수표 — 카테고리별

| 카테고리 | 점수 | 메모 |
|---|---|---|
| 컬러 토큰 일관성 | **B+** | 코드 측 위반 18건 (외부 브랜드/LLM 프롬프트 제외) |
| Radius 표준 준수 | **B** | 81% 표준, 51건 비표준 (그 중 24건 명백 정리 대상) |
| Shadow 일관성 | **A** | 거의 완벽 (3건만 정리) |
| 모션 일관성 | **A+** | 95% 단일 timing |
| 공유 Primitive 커버리지 | **D** | Button/Input/Modal 부재. inline 패턴 266건 |
| FeaturePage 사용률 | **D** | 5/23 (22%) |
| A11y (focus-visible) | **F** | 0 coverage |
| WCAG 대비 | **C** | mute-soft 일부 body text 위반 가능 |
| 아이콘 시스템 | **F** | 시스템 부재, ad-hoc |
| 반응형 모바일 | **C** | 데스크탑 우선, 전략 부재 |
| 톤 분리 (in-app vs bento) | **A+** | 누출 0 |
| i18n | **A+** | 누락 0 |
| **전체** | **B+** | a11y · primitive · 페이지 일관성이 주된 발목 |

---

## 3. 권장 패치 우선순위 + 예상 비용

### 🔴 P0 — A11y critical (2~3일)
1. **focus-visible 일괄 도입** — `src/components/ui/*` 의 모든 interactive 에 `focus-visible:ring-2 focus-visible:ring-amore-bg focus-visible:border-amore` 추가. Tailwind 플러그인으로 글로벌 강제 가능 검토.
2. **`text-mute-soft` body 사용 감사** — 258 곳 중 본문 사이즈 (>=12.5px) 사용 골라내서 `text-mute` 로 격상.

### 🟠 P1 — 핵심 primitive 도입 (3~5일)
3. **`<Button>` 컴포넌트 신설** — `variant: primary|secondary|ghost|destructive`, `size: xs|sm|md|lg`. 181건 inline 점진 마이그레이션 (page-by-page PR).
4. **`<Input>/<Textarea>/<Select>/<Label>`** — 동일 패턴, 85건 마이그레이션.
5. **`<Modal>` (또는 `<Dialog>`)** — `fixed inset-0` 8건 통합.

### 🟡 P2 — 일관성 정리 (1~2일)
6. **비표준 radius 24건 정리** — `2/3/8/10px` → `4` (작은 inline) 또는 `14` (카드급) 로 결정 후 일괄 변환. `999px` typo → `9999px`.
7. **Editorial `4px` 잔재 27건 처리** — 보존 결정 시 doc 에 명시 (작은 라벨용), 통일 결정 시 14px 로.
8. **FeaturePage 18 페이지 도입** — 동일 헤더 패턴 inline → primitive 사용. Dashboard 가 가장 큰 이득.
9. **`project-colors.ts` 토큰화** — 9개 색을 globals.css 에 명명 토큰으로.

### 🟢 P3 — 디테일 / 미래 부채 (2~3일)
10. **아이콘 시스템 결정** — Lucide 도입 vs 인라인 SVG 정형화. 결정 후 draft 의 §9.1 갱신.
11. **`<EmptyState>` 일괄 도입** — 16건 ad-hoc empty → primitive 사용.
12. **남은 4건 file input 을 `<FileDropZone>` 으로** 마이그.
13. **`<Skeleton>` primitive 추가** — `animate-pulse` 분산 통합.
14. **모바일 테이블 전략 결정** — 가로 스크롤 / 카드 collapse / hide-column 중 선택, 10개 테이블 적용.

### 📊 전체 비용 추산
- **1.5 ~ 2 주** (1인 풀타임 기준)
- 분할: P0 2일 + P1 5일 + P2 2일 + P3 3일 = 12일

---

## 4. draft 자체 수정 사항 (이번 audit 가 드러낸 doc 오류)

`docs/design-system-v2-draft.md` 갱신 시 반영할 점:

| 위치 | 현재 doc | 실측 | 조치 |
|---|---|---|---|
| §9.1 Icons | "Lucide React 통일" | Lucide 0 import, 인라인 SVG 16건 | "현재 미정 — Lucide 도입 결정 필요" 로 정정 |
| §7.10 우선순위 | `<Modal>` mid priority | ad-hoc 8건 발견 → High | 우선순위 상향 |
| §11.1 audit 표준 | radius 14/24/32/9999 | 4px 27건 잔존 발견 | "4px Editorial 잔재 처리 방침" 추가 |
| (없음) | — | focus-visible 0 coverage | 새 §9.2 보강 항목으로 추가 |
| (없음) | — | WCAG 대비비 우려 | 새 §3.7 (사용 규칙 안) 추가 |

---

## 5. 다음 단계

1. **이 audit doc 검토** — 사용자가 우선순위 / 패치 범위 합의
2. **draft (PR #188) 갱신** — §4 의 사실 오류 정정 + audit 결과 반영
3. **P0 부터 PR 분할 진행** — 각 patch 별 1~3 PR
4. **patch 진행 중 audit 재실행** — 같은 grep 으로 위반 수치 감소 추적

---

## 6. 부록 — audit 재현 명령어 (grep)

```bash
# 1. 하드코딩 hex
grep -rEn "#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b" src/components/ src/app/ src/lib/ \
  | grep -vE "(globals.css|tailwind|design-system)"

# 2. 비표준 radius
grep -rEn "\[border-radius:[0-9]+px\]" src/ \
  | grep -vE "\[border-radius:(14|24|32|9999)px\]"

# 3. shadow
grep -rEn "shadow-\[" src/components/ src/app/
grep -rEn "boxShadow:" src/components/ src/app/

# 4. inline style for color/bg/border
grep -rEn 'style=\{\{[^}]*(color|background|border):[^}]*\}\}' src/components/ src/app/

# 5. 공유 primitive 사용률
grep -rl "FileDropZone" src/ | wc -l   # 7
grep -rl "EmptyState" src/ | wc -l     # 3
grep -rl "FeaturePage" src/ | wc -l    # 5
grep -rE "^\s*<button" src/components/ src/app/ | wc -l   # 181

# 6. focus-visible
grep -rE "focus-visible:" src/components/ src/app/ | wc -l  # 0

# 7. transition consistency
grep -rEoh "duration-\[[0-9]+ms\]" src/components/ src/app/ | sort | uniq -c | sort -rn

# 8. 톤 누출
grep -rln "\bbento-(card|surface|pill|tag)\b" src/ | grep -v "landing\|globals.css"

# 9. i18n 누락
grep -rE '"[가-힣]{3,}' src/components/ | grep -vE "(messages/|//|test)"
```

---

## 7. 변경 이력

- **2026-05-31** — 최초 audit. main @ `412b609` 기준.
