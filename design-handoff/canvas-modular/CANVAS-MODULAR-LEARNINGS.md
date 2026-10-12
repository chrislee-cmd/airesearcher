# 캔버스 모듈화 Phase 1 — 워커가 얻은 것

_2026-10-12 · session 61e2a5c4 · PR #1336 (main `34f60a21`). 레포 정본(writer 수확 2026-10-12) — 다음 표면 워커가 같은 함정을 다시 밟지 않게 남긴다. 원본: 워커 .jarvis/pr-canvas-modular-phase1-LEARNINGS.md_

관련: `design-handoff/canvas-modular/full/README.md` · `widget-chain/CHAIN-UI-LEARNINGS.md`(선행 필독) · `src/components/canvas/palette/`

---

## 1. 픽셀 diff 는 "스크린샷 눈대중"이 아니라 **CD 를 실제로 렌더해서 겹치는 것**이다

전사규칙 2d 가 말한 오라클을 이번에 처음 제대로 돌렸고, **그게 결정적이었다.**

핵심 발견: **`support.js` 가 React UMD 를 CDN 에서 자가 로드한다**(`loadReactUmd()`). 즉 `.dc.html` 은 **브라우저에서 standalone 으로 렌더된다** — CD 환경이 따로 필요 없다. 로컬 정적 서버 하나만 띄우면 된다:

```js
// file:// 는 CDN 스크립트/CORS 가 막힌다 — http 로 서빙할 것
const server = createServer(...); server.listen(0, '127.0.0.1');
await cd.goto(`http://127.0.0.1:${port}/canvas-modular-full.dc.html`, { waitUntil: 'networkidle' });
await cd.waitForFunction(() => !!window.React && !!document.querySelector('#P0'));
```

이게 되면 **CD 가 그린 DOM 에서 `getComputedStyle`·`getBoundingClientRect` 를 직접 읽을 수 있다.** 워커가 소스에서 값을 베껴 적는 것과 질이 다르다 — 베끼기는 내 독해가 틀리면 같이 틀리고, 실렌더 실측은 틀릴 수가 없다.

**실제로 이 방법으로만 잡힌 결함**: 타일 이름 줄상자가 CD 16px ↔ 우리 `text-lg` 토큰 20.2px 이라 두 줄 블록이 4px 커지고, 세로 중앙 정렬이라 **블록 전체가 2px 위로** 올라가 있었다. 스크린샷을 눈으로 백 번 봐도 안 보이고, 계산 스타일 대조도 "내가 비교하기로 한 속성"만 보므로 `line-height` 를 비교 목록에 안 넣었으면 못 잡는다. **CD 렌더와 rect 를 겹쳐서야** 나왔다.

> **다음 워커에게**: CD 번들을 받으면 **제일 먼저 `.dc.html` 을 띄워 보라.** 구현 전에 띄우면 치수·색을 읽어 쓸 수 있고, 구현 후에 띄우면 오라클이 된다. 번들에 `support.js` 가 같이 왔으면 거의 확실히 렌더된다.

## 2. 픽셀 diff 는 **마스크를 먼저 정의**해야 숫자가 의미를 갖는다

처음 돌렸을 때 diff 14.3% 가 나왔다. 패닉할 숫자지만 **대부분이 의도된 차이**였다:
- 톤 타일 글리프 — 듀오톤 세트 채택(리브랜드 1단계 결정, CD §10 "컴프 아이콘은 자리표시")
- 크레딧 숫자 — CD 는 💎1, 우리는 FEATURES 메타의 💎25
- 이름 서체 — CD 13.5px(Pretendard static CDN) ↔ 우리 13px(`--text-lg` 가 13/13.5 흡수, `text-[Npx]` 는 lint 차단)

**의도된 차이를 마스크로 빼고 나니 chrome diff 가 0% 였다.** 즉 프레임·바탕·톤 타일 박스·그립이 CD 와 **픽셀 단위로 동일**하다는 뜻이고, 그게 실제로 검증하고 싶었던 것이다.

> **규칙**: diff 숫자를 보고하기 전에 **"이 차이는 의도된 것인가"를 영역별로 분류**하라. 분류 없는 퍼센트는 통과/실패 판정에 쓸 수 없다. 그리고 **마스크한 영역은 반드시 근거와 함께 적어라** — 안 적으면 다음 사람이 "뭘 숨겼나" 를 의심한다.

### 2a. 같은 **상태**끼리 겹쳐라 (내가 처음 틀린 것)

첫 비교에서 CD 는 장면 P1a 의 `chain` 상태 타일을, 프리뷰는 `idle` 타일을 잡아 9.4% 가 나왔다. **상태가 다른 두 그림을 겹친 것**이다. P0 상태 사전은 12상태를 1:1 실치수로 다 그려 놨으니 **거기서 같은 key 의 셀을 뽑아** 겹치면 된다.

```js
// P0 셀에서 상태 key 로 타일 찾기 — mono 폰트 휴리스틱 말고 **알려진 키 목록과 정확 일치**로.
const KEYS = ['idle','hover','focus','press','fit','source','lifted','chain','run','attn','multi','expanded'];
const key = [...cell.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => KEYS.includes(t));
```

## 3. dc 런타임은 inline style 을 **React 직렬화 형식**으로 다시 쓴다

`.dc.html` 소스에는 `style="width:240px;height:800px"` 로 적혀 있지만, 렌더된 DOM 의 `getAttribute('style')` 은 **`width: 240px; height: 800px`**(공백 포함)이다. 소스 문자열로 셀렉터를 짜면 전부 미스한다.

```js
const norm = (el) => (el.getAttribute('style') || '').replace(/\s+/g, '');   // 또는 rect 로 찾기
```

## 4. 기하 판정으로 바꿔도 **"언제 판정하나"를 빠뜨리면 안 켜진다**

`mouseenter/leave` 를 버리고 좌표 판정으로 갔는데, 내 첫 구현은 React `onPointerMove` 가 `tracking` 만 켜고 **판정을 예약하지 않았다.** window 리스너는 그 다음 이벤트부터 붙으므로, 팔레트에 **처음 들어온 프레임이 영영 flush 되지 않았다** → 포인터가 한 번 더 움직여야 hover 가 켜졌다. 실사용에서는 "첫 타일만 반응이 굼뜸"으로 나타난다.

> **규칙**: "리스너를 켜는 이벤트"도 **하나의 샘플**이다. 켜면서 그 좌표로 **판정도 같이 예약**하라.

## 5. 제스처 플래그는 **제스처 단위로 비워라** (드롭 직후 누르기가 삼켜졌다)

드래그로 번진 pointerdown 의 click 을 막으려고 `draggedClickRef` 를 뒀는데, **성공 드롭에는 그 플래그를 소비할 click 이 따라오지 않는다.** 플래그가 true 로 남아 **다음 타일 누르기가 통째로 무시**됐다(P1b 팬·링이 안 돌았다).

> **규칙**: "직전 제스처가 무엇이었나" 플래그는 **새 pointerdown 이 비운다.** 소비 시점에 의존하면 소비가 안 일어나는 경로에서 반드시 샌다.

## 6. 퇴역의 완전성은 **"남은 코드가 성립하나"** 에서만 드러난다

그리드를 떼어내자 줄 수로는 안 보이는 것 둘이 드러났다:
- `lane.originIndex`(해체 시 돌아갈 셀) + FLIP 복귀 애니메이션 → **돌아갈 좌표가 존재하지 않는다.** 남기면 "좌표 없는 좌표"를 들고 다닌다.
- "카드가 작업면에 보인다"는 **전제** → 카드를 unmount 하면 라이브 세션이 끊기므로 **숨은 호스트 상시 마운트 + 도킹분만 portal** 로 재배선해야 했다.

그리고 **기능의 목적지가 사라지는 경우**가 있다: v3 의 "카드를 셀로 끌어내 언도킹" 은 셀이 퇴역해 목적지가 없어졌다. 대체 목적지를 발명하지 않고(§5 가 "빈 작업면에 놓기 = 취소"라 충돌한다) 키보드 경로만 보존 + PR 에 명시해 올렸다.

> **규칙**: 퇴역 PR 에서 grep 0 은 **시작**이다. "이 심볼이 사라지면 **의미를 잃는 다른 것**이 뭔가" 와 "이 기능의 **목적지**가 같이 사라지지 않나" 를 따로 물어라.

## 7. 레인처럼 **transform 안에 있는 표면**은 CD 절대값이 1:1 로 안 옮겨진다

CD 렌더 실측: 레인 border 1px · radius 16px. 우리: 3px · 20px. **의도적이다** — 레인은 캔버스 transform 안에서 ~0.4 배로 보이므로 1px 선은 sub-pixel 이 된다(3px × 0.4 ≈ 1.2px 로 읽힌다). 제약 1 이 레인 치수를 동결한 것도 같은 이유다.

> **규칙**: CD 값을 옮기기 전에 **그 표면이 어느 좌표계에 사는지** 물어라. 화면 고정 표면(팔레트·툴바)은 1:1, transform 안(레인·카드)은 **색·선종류·그림자·서체만** 가져오고 치수는 그 표면의 기존 스케일을 따른다. (§8-5 의 "배치 방식이 바뀌면 승계가 아니라 재작성" 과 같은 계열.)

## 8. 레포 게이트 — 이번에 새로 걸린 것

- **한글 리터럴 가드**: `josa(widget, '을를')` 의 **쌍 식별자**가 "신규 하드코딩 한글" 로 잡힌다. UI 카피가 아니라 `korean-particle.ts` 의 문법 테이블 키다 → `// i18n-allow-korean -- 사유`. (§8-9 와 같은 건이 또 났다 — josa 를 쓰는 **모든** 신규 호출부에서 난다고 보면 된다.)
- **`react-hooks/set-state-in-effect` 가 error**: effect 본문의 동기 setState 전부. 회피 패턴 둘 — ⓐ **rAF 안으로** 넣기(초기 fit·딥링크처럼 "레이아웃이 가라앉은 뒤" 가 맞는 것은 어차피 rAF 가 옳다) ⓑ **파생으로 바꾸기**(`laneEl ? laneBox : ZERO_BOX` — effect 에서 0 으로 되돌리는 대신).
- **`pnpm lint` 가 2~3분**: pre-commit 훅이 2분 타임아웃을 넘긴다. 커밋은 **백그라운드 또는 긴 타임아웃**으로 돌릴 것. 중간에 끊기면 `lint-staged automatic backup` stash 가 남으니 커밋 성공 확인 후 `git stash drop`.
- **SSR 포털**: `Modal` primitive 와 같이 `typeof window === 'undefined'` 가드면 충분하다(mount 플래그 + effect 는 위 규칙에 걸린다). 사용자 조작 이후에만 마운트되는 포털이라 hydration 불일치가 없다.

## 9. 오라클 하네스 메모

- **자격은 스크립트가 `.env.local` 에서 직접 읽어라.** 셸 `set -a && . .env.local` 는 값에 따옴표·특수문자가 있으면 깨진다(로그인 타임아웃으로 나타났다).
- **줌은 CDP 로**: Playwright `mouse.wheel` 은 `ctrlKey` 를 못 싣는다. `Input.dispatchMouseEvent { type:'mouseWheel', modifiers: 2 }` 를 **틱마다 하나씩** + 목표 줌 도달 시 break(§8-8).
- **PNG 디코더가 없어도 된다**: 두 크롭을 base64 로 브라우저에 넘겨 `<img>` → canvas → `getImageData` 로 비교하면 node 쪽 의존성이 0 이다.
- **순서가 결과를 바꾼다**: 레인에 카드를 넣으면 다음 단계가 산출물 노드로 닫혀 **빈 슬롯이 사라진다**(`laneHasReportNode`). 키보드·저줌 검증은 **도킹 앞**에 두고, 도킹은 슬롯이 남는 순서로.
- **프로덕션 DB 쓰기는 워커가 집행하지 않는다.** service-role 상태 주입은 classifier 가 차단했고, 우회하지 않고 writer/사용자에 올린 것이 맞았다(writer 가 "무수정 경로 + 파일럿 기검증" 으로 생략 판정). §7-5 의 "과금 액션은 임의 집행 금지" 와 같은 계열 — **쓰기도 그렇다.**
