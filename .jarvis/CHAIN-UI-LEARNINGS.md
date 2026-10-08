# 위젯 체인 UI — v1/v2 에서 얻은 것 (v3 워커용)

_2026-10-08 · D 워커 세션(c0497626). PR #1329(v2) 동결 시점 기록._

이 문서의 용도는 **같은 함정을 다시 밟지 않는 것** 하나다. v3(도킹 레인)를 받는
워커가 CD 번들보다 **먼저** 읽는 것을 전제로 썼다. 코드 사실은 전부 프리뷰 실측
또는 소스 확인으로 검증된 것이고, 추측은 "추정" 이라고 적었다.

관련 파일: `design-handoff/widget-chain/` (v1 번들 · `v2/` · `CONTEXT-FOR-CD-V3.md`) ·
`src/lib/chains/` · `src/components/canvas/chain/` · `.jarvis/wrap-up.md`

---

## 1. v1 → v2 가 어긋난 축 — 배치가 아니라 **구성의 소유권**

| | 설계 | 기각 사유(사용자) |
|---|---|---|
| v1 | 캔버스 상단 체인 바 + 위젯 안 토글 | "위젯 **간**의 체인을 의도했는데 위젯 **안**에 있다" |
| v2 | 카드 사이 커넥터 오버레이(엣지·포트·캡슐) | "체인은 **빈 상태가 디폴트**고 원하는 위젯을 드래그해 각자 만드는 것" |
| v3 | 도킹 레인 (확정) | — |

**v1→v2 는 "위젯 안/간" 이라는 *배치* 만 뒤집었다.** 나(워커)도 그 축에 맞춰
설계했고 CD 도 그 축으로 답했다. 그런데 실제로 흔들린 축은 배치가 아니라
**누가 체인의 단계 구성을 정하는가**(시스템 고정 템플릿 vs 사용자 조립)였다.
그 축은 v1·v2 양쪽 모두에서 "시스템" 으로 **암묵 고정**돼 있었고, 아무도 그걸
질문으로 꺼내지 않아서 두 번 다 같은 지점에서 어긋났다.

**신호는 코드에 있었다.** `lib/chains/registry.ts` 의 `CHAIN_TEMPLATES` 가
하드코딩된 고정 배열이었다. v2 구현 내내 그 파일을 읽고 `chainPreviewRows()` 로
소비까지 했으면서, **"이게 사용자가 바꾸는 값인가"** 를 되묻지 않았다.

> **v3 체크리스트 1번**: CD 번들을 받으면 외형보다 먼저 —
> **"이 구조를 누가 바꾸는가? 시스템인가 사용자인가?"**
> 레지스트리/상수 배열이 보이면 그게 UI 가 노출할 자유도인지 확인한다.
> (writer 도 같은 질문을 안 했다고 복기함 — 한쪽의 실수가 아니라 **핸드오프
> 프로토콜의 구멍**이었다.)

---

## 2. 상호작용 결함 3건 — 원인과 해법

v2 에서 실제로 터진 것들이다. **셋 다 정적 스타일 대조로는 안 잡혔고**, 프리뷰
실조작/실포인터 검증에서만 드러났다.

### 2-1. 줌 focus 오버레이가 포인터를 가로챔 (→ 결정 표면이 안 눌림)

- **증상**: 줌아웃 상태에서 체인 캡슐·진입 팝오버·포트 핸들의 버튼이 눌리지 않음.
- **원인**: `canvas-board.tsx` 는 `zoom < FOCUS_THRESHOLD` 일 때 **카드마다**
  `[data-canvas-focus-overlay]`(`z-overlay` = 70)를 깔아 클릭을 "그 위젯으로 줌인"
  으로 가로챈다. 체인 오버레이가 그보다 낮은 z 면 결정 표면이 통째로 묻힌다.
- **왜 치명적인가**: 체인은 **여러 카드를 한눈에 보는 줌아웃이 자연스러운 뷰**다.
  카드 내부 컨트롤이 묻히는 건 괜찮지만(멀어서 안 보임) 체인 결정은 아니다.
- **해법**: 체인 오버레이의 **조작 가능한 층만** `z-overlay` 를 준다. 오버레이는
  카드들보다 **뒤에 렌더**되므로 같은 z 에서 DOM 순서로 이긴다 → **새 z 티어
  신설 없이** 해소. 장식 층(엣지·산출물 노드)은 그대로 둔다.
- **v3 함의**: 레인이 카드를 품으므로 구조는 달라지지만, **"캔버스 전역 오버레이가
  z-overlay 로 깔린다"는 사실은 그대로다.** 레인의 조작 요소(드롭 슬롯·레인 헤더·
  캡슐)가 줌아웃에서 눌리는지 반드시 실조작으로 확인할 것.

### 2-2. hover flicker — **이벤트 기반이 틀린 도구였다** (가장 중요한 교훈)

- **증상(사용자 원문)**: "+포트 핸들이 클릭이 안 돼. 생성은 되어 있는데 호버하면
  빠르게 flicker 하면서 클릭까지는 되지 않아."
- **원인**: 핸들은 **카드의 DOM 자식이 아니다** — 포트 레이어(surface 직계)에
  그려지고, 중심이 카드 상단 테두리 위라 **위쪽 절반은 카드 bounding box 밖**이다.
  `mouseenter`/`mouseleave` 는 기하가 아니라 **DOM 포함 관계**로 판정한다 →
  포인터가 핸들에 닿는 순간 카드의 `mouseleave` 가 터진다.
- **실측 타임라인** (`v2-flick-diag.mjs`, 줌 0.52):
  ```
     7ms card.enter → vis:true
   958ms card.leave ← BUTTON     (포인터가 핸들에 닿음)
  1120ms vis:false               (디바운스 160ms 만료 — 핸들 enter 가 못 막음)
  1124ms card.enter ← SPAN       (pointer-events 끊기자 밑의 카드가 다시 타깃)
  1126ms vis:true → 1191 leave → 1353 false → 1358 true → … 루프
  ```
- **고치려다 두 번 틀린 층위를 거쳤다** — 이게 핵심이다:

  | 시도 | 결과 | 왜 부족했나 |
  |---|---|---|
  | ① 카드 hover + 핸들 hover 각각 추적 + 숨김 디바운스(160ms) | 클릭은 성립. mount/unmount **3~6회** | 핸들 enter 와 카드 leave 중 **누가 이기느냐가 보장되지 않음** — 타이머가 그대로 발화 |
  | ② unmount → opacity 토글 | DOM churn **0**, 그러나 visible 토글 **6~7회** | 증상이 DOM 에서 CSS 로 **옮겨갔을 뿐**, 상태 자체가 계속 진동 |
  | ③ **기하 판정** — 포인터 좌표가 "카드 ∪ 핸들(+여유)" 안인가 | mount **0** · visible **1**(최초 노출)/**0** · 클릭 성립 | DOM 포함 관계도, 이벤트 순서도, 타이머도 개입하지 않음 |

- **일반 규칙**: **트리거 요소가 hover 영역의 DOM 자손이 아니면 `mouseenter`/
  `mouseleave` 로 노출을 제어하지 말 것.** 이벤트 순서에 의존하는 모든 보정
  (디바운스·이중 추적)은 증상만 옮긴다. 포인터 좌표 하나로 판정하면 끝난다.
  (`pointermove` 는 rAF 스로틀 + 필요할 때만 청취 — 레이아웃 읽기 비용 관리.)
- **v3 함의**: 도킹 레인의 **드롭 슬롯 하이라이트·드래그 유효/무효 피드백**이 정확히
  같은 구조다(드래그 중인 카드와 슬롯이 서로 다른 DOM 가지). HTML5 dnd 의
  `dragenter`/`dragleave` 는 **mouseenter 와 똑같은 포함-관계 함정 + 자식 진입 시
  dragleave 가 터지는 추가 함정**까지 있다. 처음부터 좌표 기반으로 설계할 것.

### 2-3. unmount vs 투명도 토글 — **Tab 접근성이 조용히 죽어 있었다**

- hover 로만 **mount** 하면 포인터가 없을 때 그 요소는 **DOM 에 존재하지 않는다**
  → **Tab 으로 영영 닿을 수 없다.** CD README 는 "출력 포트 핸들·캡슐 버튼·요약
  pill 은 Tab 으로 접근 가능해야 한다" 고 명시했는데, 정지 상태 검증으로는 이게
  전혀 드러나지 않았다(요소가 없으니 셀렉터도 안 걸리고 "원래 그런 것" 처럼 보임).
- **해법**: 상시 mount + `opacity` 토글 + 숨김 시 `pointer-events: none`
  ("안 보이는데 눌리는" 상태 방지) + **focus 를 노출 조건에 포함**.
- **검증**(프리뷰): 포인터를 캔버스 밖으로 치운 상태 `visible=false` → 핸들 focus →
  `visible=true`, `tabbable=true`, `aria-label` 정상, **Enter → 팝오버 열림**.
- **일반 규칙**: hover 로 나타나는 컨트롤은 **mount 를 토글하지 말고 가시성을
  토글**한다. 접근성과 flicker 를 한 번에 해결한다.

---

## 3. 좌표계 · 레이어 · 검증 도구 함정

### 3-1. 캔버스는 transform 레이어다

- `[data-canvas-surface]` 는 `translate3d(pan) scale(zoom)` 으로 변환된다.
- **`position: sticky` 를 변환 레이어 안에 두면 안 된다** — 캔버스와 함께 끌려가
  "뷰포트에 고정" 이 성립하지 않는다. (v1 CD 가 바에 sticky 를 명시했지만 실제로는
  변환 밖 레이어에 absolute 로 얹어야 의도대로 동작했다.)
- **배치 원칙**: 카드를 따라가야 하는 것(엣지·포트·캡슐·산출물 노드)은 **surface
  안**, 화면에 고정돼야 하는 것(요약 pill)은 **surface 밖**.
- **측정**: `getBoundingClientRect()` 는 변환이 반영된 값이다. surface 좌표로
  환산하려면 `zoom = surfaceRect.width / surface.offsetWidth` 로 나눈다
  (`offsetWidth` 는 **변환 전** 레이아웃 폭이라 기준으로 쓸 수 있다).
  `getComputedStyle` 은 변환 영향을 받지 않는다 → **스타일 대조는 줌 무관**,
  **스크린샷/픽셀 diff 는 줌을 1 로 고정해야 유효**.
- **카드 프레임 vs 셀 래퍼**: `[data-widget-key]` 는 **셀 래퍼**(CELL_W 654)다.
  실제 카드 프레임은 그 안의 `:scope > div > [aria-expanded]`(**604×900** 고정).
  포트·엣지 끝점은 **프레임 기준**이어야 한다.
- 캔버스 그리드: `CELL_W 654 · CELL_H 950 · GAP 48` · 카드 604×900 · 3열 row-major.
  카드 사이 가로 빈틈 = 98px, 행 사이 세로 빈틈 = 98px.

### 3-2. z 티어 질서

- DS 토큰: `z-table-sticky 1` · `z-fab 40` · `z-modal 50` · `z-toast 60` ·
  `z-overlay 70`. **`z-[N]` 하드코드는 eslint 가 차단**한다(전역 스코프).
- CD 가 주는 레이어 번호(v2 의 2~8)는 **앱 전역 티어가 아니라 그 오버레이 안의
  지역 순서**다 → **DOM 렌더 순서**로 표현하면 토큰 없이 그대로 재현된다.
  조작 가능한 층만 실제 토큰(`z-overlay`)이 필요하다(§2-1).
- Picker 패널은 body 로 portal + `z-overlay` → 캔버스 위 어디든 뜬다(실측 70 > 50).

### 3-3. 검증 도구 — 정지 스냅샷의 한계

- **`elementFromPoint` 단건 체크는 정지 상태만 본다.** flicker 는 포인터가
  *움직이는 동안* 요소가 토글되는 현상이라 **원리적으로 안 잡힌다.** v2 1차
  conformance 가 "주 버튼 hittable" 로 통과시켰는데도 사용자가 못 눌렀던 이유.
- 세션에서 만든 도구 (`e2e/artifacts/conformance/`, gitignore 대상):
  | 스크립트 | 용도 |
  |---|---|
  | `v2-pointer.mjs` | `mouse.move` 를 여러 스텝으로 쪼개 **실포인터 경로**를 그리고, 그동안 대상의 mount/visible 토글 횟수를 MutationObserver 로 카운트 |
  | `v2-flick-diag.mjs` | enter/leave + 가시성 변화의 **타임라인**을 `relatedTarget` 과 함께 기록 (§2-2 로그가 이것) |
  | `v2-interact.mjs` | 탐색 줌에서 히트테스트 + **과금 0 인 cancel 경로로 실제 왕복**(DB→realtime→UI→dismiss) |
  | `v2-comp.mjs` / `v2-live.mjs` / `v2-diff.mjs` | CD 컴프 ↔ 프리뷰 계산 스타일 + 픽셀 diff |
  | `v2-kbd.mjs` | focus → 노출 → Enter 경로 |
  | `ctx.mjs` | `.env.local` 파싱 + Supabase REST 헬퍼(상태 주입/정리) |
- **상태 주입 패턴**: `widget_chains` row 를 service-role REST 로 직접 전이시키면
  realtime 이 UI 를 갱신한다 → **실세션 과금 0 으로 전 상태 도달**. 검증 후 row 는
  반드시 삭제(QA org 에 쓰레기 남기지 말 것). approve/skip/resume 은 실제 크레딧이
  나가므로 **워커가 임의 집행하지 않는다**(cancel 은 과금 0 이라 왕복 검증에 쓸 수 있음).
- **저줌에서 Playwright 클릭이 막힌다**(§2-1 focus 오버레이) → `el.evaluate(e => e.click())`
  로 DOM 클릭하거나, 카드를 먼저 클릭해 줌인한 뒤 조작.
- **픽셀 diff 는 비교 대상이 같은 배율일 때만 의미가 있다.** v2 에서 캔버스 줌
  0.45 상태로 찍어 20%대 diff 가 나왔는데 전부 배율 차이였다. 또 **장면 전체
  오버레이가 무의미한 경우**가 있다 — v2 컴프 카드는 280×360 미니, 실제는 604×900
  /3열이라 구도 자체가 캔버스 소유다(AUTHORITY: 바깥 W×H 는 캔버스, radius/border/
  shadow/타이포가 CD 절대값). 그럴 땐 **조각 단위**로 대조한다.
- **구조 검사가 픽셀보다 강한 영역이 있다**: "엣지가 카드를 가로지르지 않는가" 는
  각 `<path>` 를 `getPointAtLength` 로 121점 샘플링해 전 카드 rect 와 교차 판정하면
  **객관적으로 0/1 로 떨어진다**. 눈대중·픽셀보다 훨씬 신뢰도가 높다.

---

## 4. v2 자산 승계 인벤토리 (v3)

**그대로 포팅 가능** — 프레젠테이션 순수(props + 콜백만), 레이아웃 비의존:
- `chain-capsule.tsx` — 4톤(amber/error/success/neutral) + 프로젝트 피커. 배치는
  호스트가 주므로 레인 안으로 그대로 이동
- `chain-report-node.tsx` (200×150, pending/done) · `chain-chip.tsx` (범위 표기
  "체인 3–4/4" 포함)
- `chain-edge-layer.tsx` — **stroke 문법만** 승계(흐름 펄스 · amber 점선 · 끊김
  색/굵기 · 화살촉). path 문자열은 geometry 가 만들어 넣는 구조라 레인용 짧은
  세그먼트로 교체 가능
- `widget-chain-provider.tsx` (조회·realtime·액션·칩 파생) · `globals.css` 의
  `.chain-edge-flow`
- **`lib/chains/view.ts` 의 `deriveEdgeKinds()`** — `steps[i]`/`steps[i+1]` status
  조합만 보는 **순수 함수**라 체인 구성이 자유로워져도 그대로 유효하다.
  v3 의 "엣지 상태 문법 승계" 는 **이 함수가 실체**다.

**폐기** — 도킹으로 존재 이유가 소멸:
- `chain-port.tsx` · `chain-entry-popover.tsx` · `chain-overlay.tsx`(측정 호스트) ·
  `chain-geometry.ts`(레인·세로 거터 라우팅 — 다중 행 문제 자체가 사라짐)
- `canvas-board.tsx` 의 거터 top padding · S3b 비체인 dim

**⚠️ 고정 템플릿 전제 — 백엔드 A′(호환 그래프)와 함께 재작성**:
- `view.ts` 의 `CHAIN_STEP_WIDGET_KEY`(단계→위젯 하드 매핑) ·
  `chainPreviewRows(TEMPLATE, startAt)` · `lastEdgeTargetsReport`(마지막 두 단계가
  같은 위젯이라는 가정)

**호환 가드 SSOT (writer 확정 2026-10-08)**: `lib/chains/registry.ts` 를
**클라이언트-안전 정적 공유 모듈**로 유지하고, UI 가 `CHAIN_COMPAT_EDGES`·
`validateSteps` 를 직접 import 해 드롭 가드를 돌린다. 서버 POST 가 **같은 함수**로
권위 재검증 → "UI 는 받아줬는데 POST 가 거부" 가 구조적으로 불가능.
- ⚠️ 이 성질은 **이미 성립 중**이다 — v2 의 `view.ts`(클라 모듈)가 이미
  `registry.ts` 를 import 했고 그 상태로 프로덕션 빌드가 green 이었다. 새 제약이
  아니라 **깨지 않아야 할 기존 사실**이다.
- 깨지는 경로는 하나: `registry.ts` 에 서버 전용 import(`@/lib/supabase/admin` ·
  `next/headers` · `server-only` · env 직접 참조)가 **한 줄이라도** 들어가면 클라
  번들 빌드가 터진다. 현재 외부 의존은 `@/lib/features`(순수 상수)뿐.
  `state.ts`(SupabaseClient 의존)에는 두면 안 된다.

**백엔드(A·B·C·E)와 `ChainView` 계약은 v1 이후 불변** — v3 도 손대지 않는다.

---

## 5. canvas 전역 스타일이 신규 컴포넌트를 덮는다 (재발 1순위)

`globals.css` 의 `[data-canvas-body]` 스코프 규칙은 **위젯 본문 안에 렌더되는 모든
것**에 적용된다. 신규 컴포넌트를 위젯 안에 넣으면 아래가 **조용히** 덮인다 —
lint·typecheck·단위 대조는 전부 통과하고 **화면에서만** 틀어진다.

| 규칙 | 효과 | 회피 |
|---|---|---|
| `:is(h1,h2,h3,.text-xl,.text-2xl,.text-3xl,.text-display)` | `font-size: 26px · weight 800 · line-height 1.1` | **`.text-xl` 은 캔버스 안에서 "15px" 이 아니라 display 헤딩 훅이다.** 본문용 소제목은 `text-lg`(13) 이하를 쓴다 |
| `button:not([data-canvas-action])` | memphis border 2.5 · radius · padding `.4rem .85rem` · shadow | 자체 chrome 을 가진 버튼에 **`data-canvas-action`** 부착 (IconButton·ControlTrigger·WidgetAccordion 선례) |
| `:is(input, textarea, select)` | border/radius/padding 강제 | 위와 동일 계열 — primitive 를 쓰거나 opt-out |

**실제로 당한 것(v1)**: 진입 블록 제목이 26px 로 부풂 · 토글과 모드 세그먼트가
memphis 박스로 깨짐. **둘 다 픽셀 diff 오라클이 잡았고, 스타일 probe 는 못 잡았다**
(probe 는 "내가 지정한 클래스" 를 확인하지 cascade 결과를 확인하지 않는다).

**스코프 경계 — "카드 안이냐" 가 아니라 "`[data-canvas-body]` 안이냐" 다.**
`[data-canvas]`(보드 컨테이너)는 **배경만** 칠한다. cascade 가 걸리는 범위는
`widget-shell` 의 **바디 래퍼**(`<div data-canvas-body>` = `ExpandedBody` 를 감싸는
것) 안쪽뿐이다.

실증: v2 의 `ChainChip` 은 **카드 안에 주입되지만 cascade 밖**이다 — 셸의 서브바
(`data-widget-subbar`)가 헤더밴드와 바디 래퍼 **사이의 형제**라 `[data-canvas-body]`
바깥이고, 그래서 칩은 `.text-xl`·native button 함정을 전혀 겪지 않았다. 반면 v1 의
`ChainEntryBlock` 은 `ExpandedBody` 안(= 바디 래퍼 안)이라 제목·토글·세그먼트가
전부 덮였다.

> **D-v3 스펙 제약으로 채택됨** (writer 확정 2026-10-08): "레인 chrome 은 surface
> 레벨 · 도킹 카드 표시는 **바디-래퍼 밖 슬롯**(`subbarEnd` 경로)만 · `ExpandedBody`
> 진입 시 cascade 전면 대응 필요." 아래는 그 근거다.

→ **"도킹된 카드에 아무것도 주입하지 말 것" 은 과한 제약**이다. 정확한 규칙은:
카드에 주입하되 **바디 래퍼 밖의 셸 슬롯**(서브바 같은)을 쓰면 안전하고,
`ExpandedBody` 안으로 들어가는 순간 `data-canvas-action`·토큰 회피 등 opt-out 이
전부 필요해진다. v3 에서 도킹 카드에 체인 표시를 붙인다면 **서브바 슬롯 경로를
그대로 쓰는 것이 이미 검증된 안전 경로**다(v2 에서 셸 diff = 슬롯 1개로 끝났다).

**같은 계열(그러나 cascade 아님)**: `ControlBoardPanel` 의 `fill` 은 Region 을
`flex-1 min-h-0` 으로 누른다 — **자식이 하나일 때만 성립하는 값**이다. 형제를
추가하면 기존 콘텐츠가 축소된 박스를 넘쳐(`overflow: visible`) 새 형제 **위에 겹쳐
그려진다**. v1 에서 진입 블록이 셋업 아코디언에 깔렸던 원인.
→ **교훈**: 기존 레이아웃 컴포넌트에 형제를 추가할 때는 그 컴포넌트의 prop 이
"자식 수" 를 전제하는지 확인한다.

---

## 6. 레포 게이트 — 걸려본 것들

- **lint(error, 머지 차단)**: `text-[Npx]` · `z-[N]` · `[border-radius:Npx]`(토큰값) ·
  `rounded-[…]` · `shadow-[…]`(위젯 스코프) · **native `<button>`**(`react/forbid-elements`).
  통과하는 것: `border-[1.5px]`(소수점이라 `\d+px` 패턴에 안 걸림) · 순수 레이아웃
  arbitrary(`w-[1040px]`·`gap-[14px]`·`leading-[1.3]`).
- **native button 은 per-line disable 이 관례**다 — CD 전용 chrome 이 Button
  primitive variant 와 형태가 다르고 §7.11(컴파일 CSS 소스 순서) 때문에 className
  override 가 불확정일 때. 사유를 반드시 적는다(`fullview-header`·`desk-fullview-body`
  에 선례 다수).
- **`react-hooks/set-state-in-effect`** 가 error 다. effect 본문의 동기 `setState` 는
  금지 — 초기 fetch 반영 등 불가피하면 per-line disable + 사유.
- **`check:i18n` 은 4로케일 exact parity** 를 요구한다(en 기준, ko/ja/th 전부).
  키 하나 빠지면 red.
- **`check:design`** 은 baseline 대비 ratchet. `var(--token)` 참조 inline style 은
  통과하므로, 토큰이 없는 CD 절대값은 inline + var 로 쓰거나 토큰 승격한다.
- **`pnpm test` 의 `tests/check-design.test.ts` 2건은 이 브랜치 이전부터 실패**한다
  (clean tree 재현 확인). CI hard gate 가 아니므로 범위 밖 — 새 워커가 자기 탓으로
  오인하지 말 것.
- **로컬 `pnpm build` 금지**(워커 동시 실행 시 부하). 빌드 검증은 Vercel preview.

### 주석 함정 (실제로 당함)
- JSDoc 안의 `**msgB**/msgC` 같은 표기는 **`*/` 를 포함해 주석을 조기 종료**시킨다
  → 파일 전체가 파싱 깨짐. 마크다운 강조를 JSDoc 안에 쓸 때 슬래시와 붙지 않게 할 것.
- 같은 함정의 CSS 판: `globals.css` 주석 속 `--fv-*/` 가 빌드만 깨뜨린 선례가 있다
  (lint·typecheck 는 통과) — `.jarvis` 상위 메모리에도 기록돼 있음.

---

## 7. 핸드오프 프로토콜 — 다음엔 이렇게

1. **CD 번들 수령 시 1번 질문**: "이 구조를 누가 바꾸는가"(§1). 외형 검토는 그 다음.
2. **스펙에 모호함이 있으면 보수적 해석 + PR 본문 명시** — v1/v2 에서 서버 라우트
   3건(GET project_id 선택화 · approve 본문 project_id · resume 신설)을 이렇게
   처리했고 writer 가 그대로 승인했다. 임의로 넓히지도, 조용히 좁히지도 않는다.
3. **CD 가 안 그린 상태를 발명하지 않는다.** 캡슐이 위 행 카드와 겹치는 케이스는
   뒤집기 규칙을 만들지 않고 **CD 되물림으로 남겼다** — writer 가 그 판단을 승인했다.
4. **conformance 는 2축으로**: ① CD 조각의 계산 스타일 + 픽셀 diff ② README
   Done-when 의 구조 검사(기하·상태·유령). 그리고 **③ 실조작**(실포인터 경로 +
   과금 0 경로 왕복)을 반드시 추가한다 — ①②만으로는 §2 의 셋을 전부 놓친다.
5. **과금 액션은 워커가 임의 집행하지 않는다.** 사용자 프리뷰 단계로 넘긴다.
6. 브라우저는 작업 끝에 닫는다(전역 규칙 — 누적 시 시스템 크래시 선례).
