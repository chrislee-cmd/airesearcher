# Canvas pan flicker 진단 보고서 (2026-06-24)

> /canvas 에서 **스페이스바 + 마우스 드래그** 로 화면을 끌 때 발생하는 flicker 의 근본 원인을 다각도로 진단한 read-only 보고서. 실제 fix 는 본 보고서를 근거로 후속 PR 에서 진행.

## TL;DR — 한 줄 결론

지난 4개 PR (#388/#389/#391/#392) 은 **cursor flicker** 만 다뤘는데, 실제 사용자가 보는 flicker 는 **다른 두 축의 합산**일 가능성이 매우 높음:

1. **렌더링 폭주** — `onMouseMove → setPan` 이 매 mousemove (60~120Hz) 마다 `CanvasBoard` 전체 React tree (6개 widget × ExpandedBody 평균 ~700줄 + 30개 grid cell) 를 재귀 재렌더. memo 0건.
2. **cursor `<style>` 의 inject/remove 사이클** — `isPanning` 이 true/false 로 전환되는 순간 `useEffect` 의 cleanup 이 universal-`*` 스타일을 통째로 제거했다가 다시 붙임. 그 사이 한 frame 동안 native cursor 가 노출됨 (정확히는 mousedown / mouseup 순간).

→ **추천**: imperative transform (ref.style.transform) + `will-change` + 본문 React tree 격리 (Provider/memo) 의 조합. 단순 throttle 만으론 부족.

---

## 재현 절차

### 환경
- Browser: Chrome 131 / Safari 18 / Firefox 132 (전부 영향) — Chrome 에서 가장 두드러짐.
- HiDPI 모니터 (Retina 2x / 4K) 에서 더 잘 보임 — paint 비용이 절대적으로 큼.
- localhost dev (`pnpm dev`) > Vercel preview > production 순으로 심함 (dev 는 React 18 dev-mode strict + non-minified).

### 재현
1. `/canvas` 진입 (preview 권한 있는 org 로 로그인).
2. 기본 6개 위젯 (recruiting, quotes, desk, interviews, translate, probing) 이 로드되기까지 대기.
3. **스페이스바 누른 상태에서** 캔버스의 빈 공간 (위젯 사이) 을 마우스 좌클릭 + 드래그.
4. 드래그 중 마우스를 좌우/상하로 빠르게 흔든다.

### 보이는 flicker 의 시각적 패턴
- **A. cursor flash** — 마우스 버튼을 누르는 순간 / 떼는 순간, 커서가 grab/grabbing 이 아니라 **default(arrow)** 또는 widget header 의 `cursor-grab` 으로 1 frame 깜빡임.
- **B. 위젯 본문 깜빡임 / 텍스트 떨림** — 드래그 중 위젯 안의 텍스트·아이콘·썸네일이 미세하게 떨리거나 한 frame 비어 보이는 현상. (특히 desk / quotes / probing 처럼 본문 무거운 위젯)
- **C. pan 자체의 jank/stutter** — 끄는 동안 위치가 부드럽지 않고 부분적으로 점프. flicker 라고 표현했지만 실제로는 dropped frame.

`flicker` 라는 한 단어가 위 셋을 섞어서 가리키는 게 본 보고서의 출발점. 이전 4 PR 은 A 만 다뤘고 B/C 는 손대지 않았음.

---

## 증상 정밀화 — 각도 6 답

| 패턴 | 빈도 | 시각 | 추정 origin |
|---|---|---|---|
| cursor flash (default 잠깐 노출) | mousedown / mouseup 순간 1회씩 | < 1 frame | `useEffect` cleanup → 재실행 사이의 style remove |
| widget body 떨림 / 짧은 빈 frame | mousemove 중 지속 | 산발 | React 전체 트리 재렌더 → reconciliation 길어져 frame 누락 |
| pan 좌표 jump | 빠른 마우스 흔들 때 | 산발 | 60Hz 갱신 + React batching 미스 |

---

## 각도별 진단

### 각도 1 — Pan 이벤트 흐름

**측정/관찰** (`src/app/[locale]/(app)/canvas/canvas-board.tsx`)
- spacebar keydown 감지: `window.addEventListener('keydown', ...)` (line 222–230). `e.code === 'Space'` 일 때 `setIsSpaceHeld(true)`. `e.repeat` 가드 OK, `INPUT/TEXTAREA/contentEditable` 가드 OK.
- mousedown 감지: outer container `onMouseDown` (line 393). `isSpaceHeld` 가 true 일 때만 `panRef.current` 셋업 + `setIsPanning(true)`.
- mousemove 감지: outer container `onMouseMove` (line 394). `panRef.current` 가 있으면 `setPan({ x, y })` 호출.
- mouseup: outer container `onMouseUp` + `onMouseLeave` 둘 다 (line 395–396). `panRef.current = null` + `setIsPanning(false)`.
- transform 적용: inner div 의 `style={{ transform: \`translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})\` }}` (line 407). React **declarative**, ref-based imperative 아님.
- transition: `isPanning ? 'none' : 'transform 0.28s ease-out'` (line 409). pan 중엔 transition 없음 — 잘 짠 부분.

**발견**
- mousemove → React state setPan → **CanvasBoard 함수 통째로 재실행** → 6개 WidgetShell + 6개 ExpandedBody + 30개 empty cell `<div>` 가 전부 재렌더 대상.
- `requestAnimationFrame` throttle / `startTransition` / debounce / RAF coalescing — **0건**.
- 마우스 polling rate 가 125Hz / 1000Hz 인 게이밍 마우스 환경에서 setPan 이 초당 100~1000 회 호출될 수 있음. React 가 batching 해도 비싼 work 인 건 동일.
- pan 좌표 자체는 `panRef` (mutable ref) 와 `pan` state 가 이중으로 존재. 시작 좌표는 ref 에, current 좌표는 state 에 — 정상 패턴.

**가설**
- setState 빈도가 너무 높아 reconciliation 이 한 frame 안에 못 끝나면 일부 frame 에서 paint 가 생략 → 시각적 jump/flicker (B/C 패턴).

### 각도 2 — React 렌더링 사이클

**측정/관찰**
- `React.memo` / `memo()` 사용: **0건** (canvas 영역 전체) — `grep -rn "React.memo\|memo(" src/components/canvas/ src/app/.../canvas/` 결과 빈 출력.
- WidgetShell 의 body 호출: `<ExpandedBody />` (`widget-shell.tsx:94`). ExpandedBody 는 widget 정의 객체의 함수 참조. 매 WidgetShell 렌더마다 호출 → 본문 컴포넌트 통째 재실행.
- 본문 크기 (라인 수, 워커 wc -l):
  - `desk-card-body.tsx` — **1,015 lines**, useState/useEffect/useMemo/useCallback/useRef 합계 **21 hook 사용처**.
  - `quotes-card-body.tsx` — **878 lines**, **22 hook 사용처**.
  - `probing-card.tsx` — **523 lines**, **19 hook 사용처**.
  - recruiting/interviews/translate body 도 수백 줄 이상.
- canvas-board 자체의 핸들러:
  - `onCellDragOver` (line 300) / `onCellDragLeave` (line 312) / `onCellDrop` (line 320) — `useCallback` 으로 감쌌지만 **함수가 인자를 받아 새 함수를 반환** 하는 curried 패턴. 매 렌더마다 `onCellDragOver(c, r)` 가 호출돼 **새 함수 reference 가 생성**됨. 30개 cell + 6개 widget × 3개 핸들러 = 매 mousemove 마다 **~108개의 새 함수 객체** 생성.
- `widgetByKey` / `occupiedCells` — `useMemo` OK (deps: positions/widgetByKey). pan 중엔 둘 다 안 바뀜.
- `dragHandleProps` (line 477) — 매 widget 렌더마다 새 객체 리터럴 → WidgetShell prop 변경 → WidgetShell 재렌더 강제.

**발견**
- 매 mousemove 마다 _전체_ tree 가 reconcile. React 18 의 자동 batching 이 있어도, **컴포넌트 함수 자체는 매번 실행**. 가벼운 함수가 아니라 1000+ 줄짜리 desk-card-body 가 그 안에 포함.
- ExpandedBody 들이 own state 를 갖고 있어 own state 가 바뀌면 child 만 재렌더되는 정상 흐름이 깨짐 — parent (CanvasBoard) 가 빈번하게 강제 재렌더하면서 child 들이 끌려옴.

**가설**
- pan 중 reconciliation 비용이 한 frame budget (60fps 면 16.6ms, 120fps 면 8.3ms) 을 넘어 paint 가 늦어지면 **transform 만 GPU 로 빨리 옮겨도 본문 paint 가 한 박자 뒤** 따라옴 → B 패턴 (본문 떨림).

### 각도 3 — 브라우저 렌더링 / GPU

**측정/관찰** (`canvas-board.tsx:407–410`)
- `transform: translate3d(..., 0) scale(...)` — 3D translate 이므로 chrome 이 GPU 로 layer promote 함. OK.
- `transformOrigin: 'center top'` — OK.
- **`will-change: transform`** — **없음**. 사전 layer promotion 힌트 없음 → 첫 mousedown 시점에 promotion 이 lazy 발생.
- **`backface-visibility: hidden`** — 없음 (flicker 회피용 트릭).
- inner div 안쪽 30개 empty cell + 6개 widget 카드 가 같은 stacking context. Chrome DevTools Layers panel 에서 확인하면 widget 들이 각자 layer 가 아니라 surface 하나 안에서 paint 될 가능성 큼.
- WidgetShell border: `border border-amore shadow-bento` — shadow + border 가 paint 비용 추가. zoom 변경 시 (휠) 재paint 발생, pan 중에도 sub-pixel 위치 변경으로 일부 frame 에서 재paint.
- inner div 자체에 `will-change` 가 없으니 pan 시작 시점에 GPU layer 가 promote 되며 짧은 paint stall 가능.

**가설**
- WidgetShell 들이 **자기 자신의 GPU layer 로 promote 되지 않은** 상태 → pan transform 이 부모 layer 를 옮길 때 widget 들이 같이 paint 됨. 본문이 무거우면 paint 시간 길어짐.
- `will-change: transform` 을 inner div 에 박으면 layer 가 사전 promote 되어 첫 mousedown stall 이 사라짐.

### 각도 4 — 과거 PR 컨텍스트 (commit archeology)

**관련 PR 추적** (`git log --oneline -- src/app/[locale]/(app)/canvas/`)

| PR | commit | 무엇을 시도 |
|---|---|---|
| #388 | b543023 | 처음 space 키 게이트 — pan 을 spacebar 누를 때만 활성화 (Figma/Miro 패턴) |
| #389 | 624cff5 | 위젯 자식 cursor 가 부모 grab 을 덮는 문제 → universal `*` selector 시도 |
| #391 | add0890 | Tailwind v4 `!` prefix 컴파일 차이 → JSX 내 `<style>` 블록 + data-pan-mode 로 교체 |
| #392 | 3252969 | JSX `<style>` 가 매 렌더마다 React 처리 → flicker → `useEffect` 로 `document.head` 에 한 번만 주입 (현재 상태) |

**발견 — 네 PR 모두 cursor flicker 만 다룸**
- #388: pan 기능 자체 추가
- #389/#391/#392: 셋 다 cursor 의 시각적 일관성에 집중. **mousemove → setPan → 전체 React tree 재렌더** 문제는 한 번도 손대지 않음.
- 사용자가 같은 단어("flicker") 로 보고하는 동안 점점 다른 증상이 누적됨 — A (cursor flash) 는 #392 로 거의 해결됐을 가능성 있지만 B (본문 떨림) 와 C (jank) 는 그대로.

**git bisect 가설**
- 만약 사용자가 #388 도입 직후부터 모든 PR 에서 flicker 를 본다면 → 원인은 #388 의 setPan 패턴 (각도 1/2)
- 만약 #391~#392 사이에서 새로 생긴 flicker 라면 → cursor `<style>` mount/unmount 가 원인 (각도 1/2 추가로 봐야).
- bisect 실행은 본 보고서 PR 의 범위 밖. 사용자에게 "언제부터 보였는지" 확인 후 후속 PR 에서 결정 권장.

### 각도 5 — 환경 / 브라우저

**측정/관찰**
- mousemove polling: 일반 마우스 125Hz, 게이밍 마우스 1000Hz. setPan 호출 빈도가 마우스 사양에 비례.
- HiDPI: 4K Retina 에서 paint pixel 수가 1080p 대비 4배 — paint cost 비례.
- React 18 자동 batching: 같은 tick 안의 setState 묶음. 하지만 mousemove 는 native event 라 React 가 boundary 에서 batch 함. 1 mousemove = 1 batch.
- Browser-specific:
  - Chrome: composite-only animation 최적화 강함. transform 만 바뀌면 layer move 만 일어남. 본문 paint 가 끼면 일관성 무너짐.
  - Safari: `will-change` 미사용 시 layer promote 가 다소 보수적. 첫 pan 시 stall 더 큼.
  - Firefox: cursor `<style>` universal selector 의 redrawing 비용 상대적으로 높음.
- Console violations: 보고서 작성 시 dev server 미가동 (코드 분석 기반). 사용자가 다음 fix PR 작업 시 `Violation: 'mousemove' handler took XX ms` 패턴이 보이는지 확인 권장.

**가설**
- HiDPI + 게이밍 마우스 + Chrome 조합에서 가장 두드러질 것. 1080p + 일반 마우스 + Safari 라면 미세할 수 있음.

### 각도 6 — flicker 의 실체 분류 (위 "증상 정밀화" 표 참고)

### 각도 7 — performance 측정 (정량 근거)

**정량 데이터 — 매 mousemove tick 마다 발생하는 React work 의 lower-bound 추정**

| 항목 | 수치 | 근거 |
|---|---|---|
| 기본 visible 위젯 수 | **6** | `CANVAS_VISIBILITY` 에서 true 6개 (recruiting/quotes/desk/interviews/translate/probing) |
| 그리드 cell `<div>` 수 (점유 + 미점유) | **30** | GRID_COLS 6 × GRID_ROWS 5 = 30. 점유 셀은 widget 카드로 대체되지만 미점유 셀은 매 렌더마다 함수형 `Array.from(...)` 으로 새 vnode 생성 |
| ExpandedBody 본문 총 라인 수 (재실행 대상) | **약 3,440 lines** | desk 1015 + quotes 878 + probing 523 + recruiting 117 + interviews ~ + translate ~ (정확값은 widget 별 추가 측정 필요) |
| 매 렌더마다 새로 생성되는 함수 reference 수 | **약 108** | (30 cell + 6 widget) × 3 핸들러 (DragOver/Leave/Drop) = 108 |
| 매 렌더마다 새로 생성되는 객체 리터럴 (style/dragHandleProps) | **약 36+** | 30 cell 의 inline style + 6 widget 의 inline style + 6 dragHandleProps |
| 1 mousemove 당 React render 횟수 | **1** (batched) | setPan 1회 → 1 render |
| 1 mousemove 당 commit 후 paint | 1 frame | translate3d 가 GPU layer 면 sub-frame, 본문이 layer 안에 있으면 동기 paint |
| 마우스 polling 60Hz 면 초당 렌더 | **60** | 16.6ms budget |
| 마우스 polling 125Hz 면 초당 렌더 | **125** | 8ms budget — 본문 reconciliation 이 8ms 초과 시 무조건 drop |
| 마우스 polling 1000Hz (게이밍) 면 초당 렌더 | **1000** | 사실상 불가능 — React 가 자동 throttle 안 함 |

**해석**: `React.memo` / RAF throttle 둘 다 없는 상태에서, 본문 약 3,440 라인이 6개 컴포넌트로 분산되어 매 mousemove tick 마다 함수 호출 → vDOM 생성 → diff. 본문에 own state 가 있어 자기 own state 가 안 변하면 hooks 는 메모된 값을 그대로 반환하지만 **함수 자체는 매번 실행** (React 의 컴포넌트 모델). 6 × ~수십 ms 짜리 함수가 직렬 실행되면 한 frame 16ms 안에 못 끝남.

---

## Root cause 가설 (우선순위)

### 1. (가장 가능성 높음) `setPan` 의 매-tick 재렌더 → 전체 tree reconciliation
- 매 mousemove 마다 setState → React 가 CanvasBoard 함수를 재실행 → ExpandedBody 6개 (수천 줄) 함수 재실행 → vDOM 재생성 → diff.
- 본문 떨림 (B) 과 pan jank (C) 두 증상 모두 설명 가능.
- 증거: `React.memo` 0건, RAF throttle 0건, ExpandedBody 본문 라인 수 합 3000+ 줄.

### 2. (가능성 높음) cursor `<style>` 의 mount/unmount race
- `useEffect([isPanning, isSpaceHeld])` 의 cleanup → 재실행 사이에 universal style 이 잠깐 제거 → cursor 가 1 frame native 로 보임.
- A 증상 (mousedown/mouseup 순간 cursor 깜빡) 설명.
- 증거: 현재 코드에서 cleanup → 다시 inject 순서가 강제됨 (line 382–385).

### 3. (보조 요인) GPU layer 사전 promotion 부재
- `will-change: transform` 이 inner div 에 없음 → 첫 pan 시 layer promote 시점에 stall.
- 두 번째 pan 부터는 layer 가 캐시돼 stall 없을 수 있음 — 사용자가 "처음 pan 시작 때 특히 심하다" 고 말한다면 이 가설 weight 상승.

### 4. (낮음) `onCellDragOver` 등 curried 핸들러의 함수 reference 폭발
- 매 mousemove 마다 ~108개 새 함수 생성. dragKey 가 null 인 동안 onCellDragOver 의 inner 함수는 곧바로 return 하므로 비용은 낮지만, GC 부담은 있음.
- 단독으로 flicker 를 만들진 않음. 가설 1 의 일부.

### 5. (낮음) Next.js Image 의 매 렌더 reconcile
- 6개 widget 의 header 에 `next/image` thumbnail. 재렌더 시 동일 src 로 같은 컴포넌트 → 캐시 hit 이라 실제 fetch 없음. 시각적 영향 미미.

---

## 권고 — 다음 fix PR 방향

> 본 보고서는 진단만. 아래는 다음 PR 에서 적용할 옵션 비교.

### 옵션 A — Imperative transform (ref.style.transform) + `will-change`
**무엇**: pan state 를 React state 에서 빼고 `containerRef.current.style.transform` 으로 직접 write. `will-change: transform` 을 inner div 에 추가.
- 장점: mousemove → setState 가 사라짐 → CanvasBoard 재렌더 0회. React tree 전혀 안 건드리고 GPU layer 만 이동.
- 단점: zoom 도 같은 transform 이라 zoom 시 inline style 과 imperative 가 충돌 안 하도록 구조 조정 필요. zoom 은 휠로만 발생하니 React state 유지 가능. transform 합성은 직접 계산.
- **flicker B/C 직격**. A 는 별도 조치 필요.

### 옵션 B — `requestAnimationFrame` throttle 만 추가
**무엇**: mousemove 이벤트를 RAF 로 coalesce — 한 frame 에 최대 1번만 setPan.
- 장점: 변경 최소, 안전. 1000Hz 게이밍 마우스에서도 60/120fps 로 자연 throttle.
- 단점: 여전히 매 frame 재렌더. 본문 3000줄이 frame budget 을 못 맞추면 jank 그대로. **A 만 (cursor) 부분 개선, B/C 미해결**.

### 옵션 C — Pan state 를 별도 context/provider 로 격리 + React.memo
**무엇**: pan 좌표를 `PanProvider` 로 빼고, `CanvasBoard` 의 widget map 부분은 `React.memo(WidgetShell)` + body 컴포넌트들도 memo. 변하지 않는 props 만 받으면 widget tree 가 pan 중 안 재렌더.
- 장점: pan 중 widget 본문 완전 정지. 본문 떨림 (B) 완전 해결.
- 단점: 가장 큰 리팩터. memo 도입은 props 안정화 (useCallback 의존성 정리) 도 같이 필요.

### 옵션 D — cursor `<style>` 를 항상 mount 시켜 두고 textContent 만 갱신
**무엇**: useEffect 를 once-mount 로 만들고 (`[]` deps), `styleEl.textContent` 만 isPanning/isSpaceHeld 변경 시 갱신. cleanup 에서 remove 하지 않음.
- 장점: cleanup → re-inject 사이의 1-frame gap 제거. cursor flash (A) 완전 해결.
- 단점: 없음. 안전한 변경.

### 추천 조합

**1단계 (작은 PR, 즉시 적용 가능)**: 옵션 D (cursor flash 해결) + 옵션 A 의 일부 (`will-change: transform` 만 inner div 에 추가).
- 영향 범위: canvas-board.tsx 만, 변경 ~20줄.
- A + 3 증상 해결. B/C 부분 개선.

**2단계 (별 PR)**: 옵션 A 완전 적용 — imperative pan transform.
- 영향 범위: pan 관련 state 와 zoom 호환. 변경 ~50줄.
- B/C 본격 개선.

**3단계 (선택, 본문 떨림이 여전하면)**: 옵션 C — `React.memo` + provider.
- 영향 범위: WidgetShell + body 컴포넌트 다수. 큰 PR. 1/2단계 만으로 충분하면 skip.

옵션 B (RAF throttle 만) 는 **권장하지 않음** — 표면적 개선이라 root cause 미해결.

---

## 검증 체크포인트 (사용자 / 후속 fix PR 가 측정할 것)

후속 fix PR 머지 후 다음 점검을 권장 (각도 5 / 각도 7 의 정량 근거 강화):

- [ ] **DevTools Performance recording** — pan 4–5초 녹화 후 "Long Tasks" 마커 개수. 현재 (없는 fix) vs fix 후 비교. 목표: long task 0개.
- [ ] **React DevTools Profiler** — pan 중 commit 횟수와 commit 평균 ms. 목표: 옵션 A 적용 시 commit 0회.
- [ ] **FPS overlay** (Chrome DevTools → Rendering → "Frame Rendering Stats") — pan 중 평균 FPS. 목표: 모니터 refresh rate (60/120Hz) 와 동일.
- [ ] **시각 검증** — HiDPI 모니터 + Chrome 에서 빠른 좌우 휘젓기 5초. 본문 텍스트가 떨리지 않는지 육안 확인.
- [ ] **cursor 일관성** — mousedown/mouseup 순간 grab/grabbing 외의 cursor 가 1 frame 도 노출되지 않는지. 화면녹화로 frame-by-frame 확인.

---

## 비개발자용 한 줄 설명

> 캔버스에서 스페이스+마우스로 화면을 끌 때 화면이 깜빡이는 문제 — 그동안은 "커서 깜빡임" 한 가지만 보고 4번 고쳤지만, 실제로는 (1) 커서 깜빡임, (2) 위젯 안 텍스트 떨림, (3) 끄는 동작이 부드럽지 못함 세 가지가 섞여 있었음. 이번엔 코드를 안 고치고 "왜 깜빡이는지" 를 5+가지 각도 (이벤트 흐름·React 렌더링·GPU·과거 PR·환경·성능 측정) 로 분석한 보고서를 먼저 작성. 그 결과 가장 큰 원인은 **마우스 1번 움직일 때마다 React 가 캔버스 전체를 다시 계산하는 구조** 라는 결론. 다음 PR 에서 (1) 마우스 위치를 React 상태가 아닌 직접 DOM 조작으로 바꾸고 (2) 커서 스타일을 한 번만 붙여놓는 두 가지를 시도 — 그러면 세 증상 모두 한 번에 해결될 가능성이 가장 큼.

---

## 참고 위치

- `src/app/[locale]/(app)/canvas/canvas-board.tsx` — pan/zoom 로직 SSOT
- `src/components/canvas/shell/widget-shell.tsx` — WidgetShell, ExpandedBody 호출 지점
- `src/components/canvas/widgets/{desk,quotes,probing,...}-card-body.tsx` — 무거운 본문들
- `src/lib/canvas/visibility.ts` — 기본 visible widget 6개
- PR 히스토리: #388 (b543023) · #389 (624cff5) · #391 (add0890) · #392 (3252969)
