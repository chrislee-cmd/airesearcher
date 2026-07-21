# 위젯 카드 프레임 — 확정 지오메트리 (CD 실측, 해석 오차 0)

> **출처:** CD `uploads/handoff-widget-frame/GEOMETRY.md` (2026-07-20). Live Interpreter · All Open DOM `getBoundingClientRect`/`computedStyle` 실측. 손측정 아님.
> **SSOT:** `Widgets Canvas 1c.dc.html`. 좌표계 = 카드 좌상단(0,0) 기준 px. 워커용 로컬 사본.

## ⚑ 결정
**위젯 카드 = 고정 `604 × 900`px (패널 채우는 유동 아님).** integ가 넓어진 원인 = 카드를 ControlBoardPanel(가변)에 맞춰 늘림 → **604 고정 못박고 패널이 넓으면 좌측정렬(카드가 패널 안 채움).** 내부 콘텐츠도 카드 폭 따라 늘면 안 됨 — 콘텐츠 컬럼 width **514** 고정.

## 1. 카드 셸
604×900 고정 · border 3px `#1d1b20` · radius 20 · shadow `4px4px0 #1d1b20` · bg `#fff` · flex column · overflow hidden · 내부폭(테두리 제외) 600.

## 2. 헤더밴드 (높이 73)
padding 18x22 · bg 위젯 pastel · border-bottom 2px ink · flex space-between.
- 타이틀 Outfit **29px** w**800** ink ls -0.9.
- 툴바 left**380** top**24** **200×29** radius**10** border1.5 ink shadow2x2x0 · 세그 `💎credit│●status│🎨color│⤢fullview` 디바이더 1.5 ink · 세그 padding6x10 mono11/700.

## 3. 바디 (높이 751)
padding 0(아코디언 자체 여백) · overflow-y 900초과분만 바디 내부 스크롤(카드 높이 불변) · top 정렬(짧아도 900 유지).
- **레일 세로선** left**38** w**2** `rgba(29,27,32,.12)`.
- **번호 노드** **26×26** left**26**(중심 x39) · active ink/#fff · done `#16a34a`/#fff✓ · todo dim.
- **스텝 타이틀** left**64** 14.5 w800. 스텝 간격 mb 26(첫)/22.
- **콘텐츠 컬럼: left 64, width 514** (64거터 + 514, 우측마진 26). ⚠️ **모든 field 풀폭 514.**

### 스텝별
| 요소 | left | width | padding | radius |
|---|---|---|---|---|
| 드롭다운(프로젝트/언어) | 64 | **514** | 12x16 | 22 |
| method 그리드 | 64 | 514 | — | — (3열 column-gap **11**) |
| method 카드 각 | — | **164** | 13x11 | **13** |
| method 카드 선택 | — | — | — | border2 amore · **shadow `0 4px 12px rgba(255,92,138,.16)`(soft glow)** · 우상단 amore✓ 18 |
| 입력(키워드) | 64 | 514 | 11x16 | 22 |

## 4. 푸터 (높이 72)
padding 15x22 · border-top 1px `rgba(29,27,32,.08)` · footNote(좌) mono11 `#8a8693` · CTA(우) radius**999** padding11x20 w700 13.5 shadow2x2x0 rgba(.15) · active bg ink/#fff/border1.4 ink · idle bg `#eceef1`/`#8a8693`/border rgba(.10).

## 5. 아이콘
method/크레딧/업로드/스테이지 = 듀오톤 세트(`iconography-duotone/`). 채움 = 위젯 pastel. CTA/공유버튼만 흰 단색.

## 6. 위젯별
Probing sky `#cfe6ff`/25 · Interpreter mint `#cdebd9`/50 · Transcript lav `#e7defe`/25 · AI UT peach `#ffd9be`.

## 7. integ 즉시 수정 6건
1. 카드 폭 **604 고정**(패널 채우지 말 것) — 현재 넓음.
2. 콘텐츠 컬럼 **514 고정**, 드롭다운 풀폭 — 현재 좁게 몰림.
3. 카드 높이 **900 고정** — 현재 과대(하단 공백).
4. 툴바 **🎨 color 세그** 추가(status 우측, fullview 최우측) — 현재 없음.
5. method **아이콘 듀오톤** 교체 — 현재 이모지.
6. method 선택 **soft glow** — 하드 오프셋 아님.
