# Design Context Pack — Research-Canvas (Claude Design 입력 계약)

> **이 문서는 Claude Design 이 목업(`*.dc.html`)을 그리기 전에 읽는 계약이다.** 목적: 디자인이 처음부터 **제품 어휘(토큰·프리미티브)로** 나오게 해서 핸드오프 번역비용을 0에 수렴시킨다.
> **짝 파일:** `tokens.json`(machine-readable 실값) · `DESIGN-HANDOFF-PROCESS.md`(파이프라인) · `BRAND-DESIGN-CURRENT.md`(현행 브랜드 전량).
> **SSOT:** `src/app/globals.css`(@theme). 이 문서/`tokens.json`은 그 스냅샷 export(ⓒ). 값 충돌 시 globals.css 우선.
> **갱신:** 2026-07-20 · origin/main.

---

## 0. 출력 원칙 (가장 중요)

1. **hex/px/폰트명을 직접 쓰지 마라 — 유틸리티 클래스로 그려라.** `.dc.html` 의 요소는 `class="bg-amore rounded-sm shadow-memphis-md text-ink"` 형태로. (인라인 `#ff5c8a` ❌ → `bg-amore` ✅)
2. **기존 토큰으로 표현 가능하면 무조건 토큰.** §1~4 어휘 안에서 재조립.
3. **의도적 신규(브랜드 탐색 등)는 발명하되 라벨링하라.** hex 를 몰래 쓰지 말고 `proposed-token:` 컨벤션(§5)으로 명시 → 규칙상 토큰 PR 로 승격된다. **발명 금지가 아니라 발명 표기.**
4. **프리미티브 재사용 우선.** 버튼/인풋/뱃지/패널은 §3 인벤토리에서 조립. 새 프리미티브가 필요하면 §5 로 라벨.
5. **모든 신규 문자열은 4로케일 대상**(en/ko/ja/th). 목업은 ko 로 그려도 되나, companion 에 "신규 카피 N건" 표기.

---

## 1. 컬러 어휘 (유틸리티 클래스로 사용)

**액센트(브랜드):** `bg-amore`/`text-amore`/`border-amore` = `#ff5c8a`(핑크) — **주 브랜드/액션색**(CTA·활성·선택·포커스). `amore-soft`·`amore-bg` 변형.
※ 퍼플 `#a06fda`는 raw 레이어(로고/eyebrow)라 `bg-*` 유틸 없음 — 쓰지 말 것.

**텍스트:** `text-ink`(#1d1b20 본문) · `text-ink-2`(헤딩) · `text-mute`(#5b5965) · `text-mute-soft`(#8a8693, AA 경계 — 본문 금지).

**표면/라인:** `bg-paper`(#fff) · `bg-paper-soft`(#f7f7f5) · `border-line`(0.10) · `border-line-soft`(0.06) · **`border-ink`**(검정 굵은 보더, 카드 2.5~3px).
※ 옐로 배너(#ffd53d)·사이드바 옐로(#fffce1)는 표면 토큰(`--surface-banner`/`--surface-accent-bg`)로 캔버스 셸이 자동 적용 — 직접 색 지정 X.

**시그널(의미색 — 브랜드색 아님):** `text-success`/`bg-success`(#16a34a) · `warning`(#fb923c)·`warning-bg`·`warning-line`.
⚠️ **success 그린을 "완료" 이외 용도(예: 헤더 브랜드색)로 쓰지 말 것** — 의미 충돌.

**파스텔(위젯 헤더/하이라이트):** `sky`(◐) `peach`(◆) `mint`(◉) `lav`(◇) `sun`(★) `rose`(✦). → **위젯 아이덴티티색**. Probing=`sky`, Interpreter=`mint`.

**차트(데이터뷰 전용):** `am-accent`·`pm-accent`.

## 2. 셰이프·깊이·타이포·모션

- **라디우스:** `rounded-2xs`(2) `rounded-xs`(4) **`rounded-sm`(14=기본)** `rounded-md`(24) `rounded-pill`(999). → 하드코드 `rounded-[Npx]` ❌.
- **그림자(Memphis, blur 0):** `shadow-memphis-xs`(1.5) `-sm`(2, 버튼) `-md`(3, 카드) `-lg`(4) `-2xl`(8). 색변형 `-amore`/`-warning`. → `shadow-[..]` ❌.
- **보더굵기:** 버튼 2px, 카드 2.5px, 캔버스카드 3px(검정).
- **타입스케일:** `text-xs`(10)…`text-md`(12.5 본문)…`text-2xl`(18)…`text-display`(32). 캔버스 h1-3는 26~32/800/-0.02em 오버라이드.
- **폰트:** `font-sans`(Pretendard 본문) · `font-hand`(Caveat, 희소) · Outfit(디스플레이/헤딩 — 캔버스·앱 레이아웃 로컬 `var(--font-outfit)`). **모노/ Archivo/Courier 금지**(프로덕션 본문 아님). 로고 Poppins는 SVG 전용.
- **모션:** duration `--dur-fast`(120)/`--dur`(180)/`--dur-slow`(260), easing `--ease-out`/`--ease-emphasized`(바운스). 유틸 `.fade-in-up` `.pop-in` `.shake` `.stagger` `.press-scale`. ms 하드코드 ❌.
- **아이콘:** 외부 라이브러리 없음. 유니코드 글리프(◐◆◉◇★✦) + 인라인 SVG. 이모지는 카피에 사용.

## 3. 프리미티브 인벤토리 (재조립 대상)

새로 만들지 말고 이걸 조합:

- **Button** — variants: `primary`(bg-ink/text-paper+memphis) · `secondary` · `ghost` · `destructive` · `link` · `destructive-link`. sizes: `xs/sm/md/lg`(rounded-sm) + `cta`(rounded-pill). hover 리프트(-1px)+active 눌림(scale .97).
- **IconButton** — `ghost`/`ghost-danger`/`ghost-brand`(amore)/`bordered`/`subtle`/`plain`. `aria-label` 필수.
- **Badge** — `neutral`(검정 아웃라인)/`subtle`(웜 워시)/`amore`. `rounded-pill`.
- **Input / Textarea / Select / ChipInput** — `rounded-sm`, `border-line`→focus `border-ink`, 에러시 `border-warning`+shake.
- **Modal** — sm420/md560/lg760/xl1100, `rounded-sm`, soft shadow.
- **ControlBoardPanel** (위젯 컨트롤 프레임 SSOT) — `px-5 pt-10 pb-6`, 클러스터 `max-w-2xl` 중앙, field gap `gap-4`(16), section gap `gap-6`(24). 상수 `WIDGET_FRAME_INSET_X`/`SETTINGS_ROW_GAP`.
- **WidgetShell** (캔버스 카드 셸) — banner-top 헤더(파스텔/옐로, 3px 검정 하단보더) + 코스트뱃지/상태필 + Outfit 라벨 + framed 바디(2.5~3px 검정 보더). **캔버스 카드는 이 셸 안에서** 그릴 것(임의 프레임 크기 지양 — §4 제약).

## 4. 제약 (지키면 통과, 어기면 리젝)

- **627 디자인 가드:** `scripts/check-design.ts` 가 하드코딩 색/라디우스/그림자를 **CI에서 차단**. → §0.1 지키면 자동 통과.
- **캔버스 pop-락:** `/canvas` 는 pop 테마 + 옐로 banner-top 헤더 + framed 바디에 락(`docs/canvas-design-locked.md`). 헤더 밴드색/폰트/레이아웃을 바꾸려면 **명시적 언락 결정** 필요(임의 변경 ❌).
- **위젯 아이덴티티색:** 캔버스에 여러 위젯이 깔리므로 per-widget 파스텔(sky/mint…)이 구분 기능. **단색 통일 제안은 브랜드 결정 대상**(§5 로 라벨).
- **i18n parity:** en/ko/ja/th 4로케일 동시(618 lock). 신규 문자열은 4개 다.
- **위젯 크기:** 캔버스 위젯은 WidgetShell 로 유동. 하드 픽셀 프레임(예: 604×772 고정) 가정하지 말 것 — 고정 높이/내부 스크롤이 필요하면 companion 에 이유 명시.

## 5. 신규 제안 라벨링 컨벤션 (발명을 의도된 입력으로)

기존 토큰으로 안 되는 **의도적 신규**는 아래 형식으로 `.dc.html` 주석 + companion 표에 남긴다. hex 를 그냥 쓰지 말 것.

```
proposed-token: green-header
  layer:     raw (색) | @theme (유틸) | primitive (컴포넌트)
  value:     #8ee0a6
  role:      위젯 세팅 헤더 밴드 배경
  nearest:   기존 --raw-pastel-mint(#cdebd9) 와 인접하나 채도 높음
  rationale: 유스케이스 가이드 톤 통일(브랜드 탐색)
  scope:     brand-decision   ← triage 태그(§process)
```

- **네이밍:** 기존 레이어 규칙 따름(`--raw-*` / `--color-*` / `--component-*`).
- 이 라벨이 붙은 항목은 자동으로 **triage=DS-change/brand-decision** 으로 분류돼 **토큰 PR 로 먼저 승격**된 뒤 피처가 소비한다(발명이 사고가 아니라 게이트를 타는 입력이 됨).
- **브랜드 탐색(리브랜딩)은 별 트랙:** 피처 목업이 새 팔레트를 통째 제안하면, 그건 피처가 아니라 **브랜드 토큰 제안**으로 분리해서 낸다(피처 레이아웃과 섞지 말 것).

## 6. Companion 필수 2컬럼 (목업과 함께 제출)

`*.dc.html` 옆에 구조화 companion(현행 V2 문서 포맷 OK)에 아래 2컬럼을 추가:
1. **토큰 매핑:** 각 시각요소 → 기존 유틸 클래스 / `proposed-token:<name>`.
2. **Triage 태그:** `mechanical`(토큰으로 바로) / `DS-change`(신규 토큰·프리미티브) / `product-backend`(신규 개념·데이터) / `defer`(범위 밖).

→ 예시는 `V2-TOKEN-MAP-PILOT.md`(이번 V2 를 이 포맷으로 소급 적용한 파일럿).
