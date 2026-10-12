# Handoff: Soft Identity 리브랜드 — 제품 전역 비주얼 교체

## Overview
리서치캔버스 제품 전체의 비주얼 레이어를 **Memphis(굵은 검정 테두리 + 하드 오프셋 그림자)**에서 **Soft Identity(1px 선 + 옅은 그림자 + 정체성 파스텔 유지)**로 바꿉니다. 목표는 지금보다 깔끔하고 프로페셔널한 인상이고, 일곱 위젯을 색으로 알아보는 체계는 그대로 유지합니다.

**바뀌는 것:** 색 사용 규칙, 테두리, 그림자, 모서리, 타입, 상태 배지 형태.
**바뀌지 않는 것:** 레이아웃, 화면 구성, 치수(카드 604×900, 풀뷰 1400×840, 사이드바 240 등), 데이터 계약, 인터랙션, 카피. 기존 BUILD-SPEC들의 구조와 상태 매트릭스는 그대로 유효하고, **시각 값만 이 문서로 대체**됩니다.

## About the Design Files
`soft-identity-product.dc.html`은 **HTML로 만든 디자인 레퍼런스**입니다. 의도한 생김새를 보여주는 프로토타입이며, 그대로 복사해 쓰는 프로덕션 코드가 아닙니다. airesearcher 레포의 기존 환경(Next.js + React + Tailwind, `globals.css` 토큰) 안에서 기존 컴포넌트를 이 값으로 다시 스타일링하는 것이 작업입니다. 파일은 같은 폴더의 `support.js`가 있어야 브라우저에서 열립니다(`support.js`는 런타임일 뿐, 포팅 대상 아님).

## Fidelity
**High-fidelity.** 색, 타입, 간격, 선, 그림자, 모서리 전부 최종값입니다. 카드 본문 일부는 대표 상태만 그렸으니, 그리지 않은 상태는 아래 **변환 규칙**을 적용해 만듭니다.

## 핵심 규칙 6가지 (먼저 읽기)
1. **선은 전부 1px.** 바깥 테두리 `--line`, 표면 안 구분선 `--hair`. 1.5 / 2 / 2.5 / 3px 보더는 모두 없앱니다. 예외는 점선 빈 자리(1.5px dashed `#d6d4da`)와 탭 활성 밑줄(2px ink)뿐입니다.
2. **하드 오프셋 그림자(`Npx Npx 0`)는 전부 없앱니다.** 그림자는 `--sh-card / popover / modal / frame` 네 단계만 씁니다. 버튼, 칩, 배지, 입력에는 그림자가 없습니다.
3. **파스텔 원색(`--tone-*`)은 작은 면에만** 씁니다: 아이콘 타일(24–40), 상태 점, 사이드바 표시. **넓은 면(헤더 띠, 선택 행, 요약 박스)에는 틴트(`--tint-*`)만** 칠합니다.
4. **상태 배지는 테두리가 없습니다.** 틴트 면(`--*-bg`) + 진한 글자(`--*-fg`) + 6px 점. 만료(속 빈 점: 흰 면 + 1.5px `--faint` 테두리)와 철회(채운 점: `--ink`)는 둘 다 회색 면이고 점 모양으로 구분합니다.
5. **버튼은 전부 pill.** 주 버튼은 ink 채움 + 흰 글자, 보조 버튼은 흰 면 + 1px `--line`, 아이콘 버튼은 38 원. 파괴 확정은 `--danger` 채움(모달 안에서 하나만), 목록의 파괴 액션은 `--danger` 텍스트 버튼.
6. **세그먼트/필터 토글은 `--fill` 트랙 + 흰 선택 칩**(그림자 `0 1px 2px rgba(29,27,32,.08)`)입니다. 검정 채움 세그먼트는 쓰지 않습니다.

## Memphis → Soft 변환표
| 요소 | Memphis (현행) | Soft Identity |
|---|---|---|
| 위젯 카드 | border 3 ink · radius 20 · shadow 4px 4px 0 ink | border 1 `--line` · radius 20 · `--sh-card` |
| 카드 헤더 띠 | 원색 파스텔 bg · border-b 2 ink | `--tint-*` bg · border-b 1 `--hair` · 왼쪽에 40 원색 아이콘 타일 |
| 카드 툴바 | border 1.5 ink · shadow 1.5px 0 | 흰 bg · border 1 `--line` · radius 10 · 셀 구분 1px `--hair` · 그림자 없음 |
| 풀뷰/라이브러리 프레임 | border 3 ink · radius 16 · shadow 8px 8px 0 ink/28 | border 1 `--line` · radius 16 · `--sh-frame` |
| 풀뷰 사이드바 | `paper-soft` · border-r 2 ink · 활성 항목 1.5 ink + 하드 그림자 | `--surface-2` · border-r 1 `--hair` · 활성 = 흰 bg + 1px `--line` + 700 |
| 헤더 하단선 (제품 헤더 3px / 기능 헤더 2px) | 3px / 2px ink | 둘 다 1px `--hair` (구분은 bg로: 기능 = 틴트, 제품 = 흰색) |
| 주 버튼 | ink pill · border 2 · shadow 2px 0 | ink pill · 테두리·그림자 없음 · 600 |
| 보조 버튼 | 흰 pill · border 1.5 ink · shadow | 흰 pill · border 1 `--line` |
| 상태 배지 | 틴트 bg + 1.5px 시그널 line | 틴트 bg · **테두리 없음** · `--*-fg` 글자 |
| 리스트 행 | border-b ink/8 · hover canvas | border-b 1 `#f4f3f6` · hover `--surface-2` |
| 입력/피커 트리거 | border 1.5 ink · shadow 2px 0 ink | border 1 `--line` · radius 10(검색은 pill) · focus = border ink + `--focus-ring` |
| 팝오버/피커 패널 | border 2 ink · shadow 4px 4px 0 ink/20 | border 1 `--line` · radius 12 · `--sh-popover` · 행 radius 8 · 선택 행 `--fill` |
| 모달 | border 3 ink · radius 18 · shadow 8px 0 | border 1 `--line` · radius 18 · `--sh-modal` |
| 빈 상태 타일 | 3px ink + 하드 그림자 / 2.5 dashed | 64 radius 20 `--tint-*` 또는 `--fill` · 테두리 없음 / 1.5 dashed `#d6d4da` |
| 완료 타일 | 64 · success.bg · shadow 3px 0 success | 64 · radius 20 · `--ok-bg` · ✓ `--ok-dot` · 그림자 없음 |
| 진행 밴드 | 위젯 톤 bg · border-t 2 ink | `--tint-lav` 계열 → 공통 `#f7f4ff` · border-t 1 `#ebe4fb` · 바 6px `--run-track`/`--run-dot` |
| 캔버스 바탕 | `#fbfbf9` + dot `#d8dad6` | `--canvas` + dot `--canvas-dot` 22px |
| 인용 블록 | — | 왼쪽 2px `--tone-rose` 선 + 15/1.75 + mono 메타 (italic 금지 유지) |
| 근거 칩 | radius 4 · border | `--fill` bg · radius 5 · mono 11 · 테두리 없음 |

## Screens / Views
모두 `soft-identity-product.dc.html`에 실제 크기로 있습니다.

### 00 시스템 시트
톤 7 × (원색, 틴트), 중립 7, 시그널 4, 타입 견본, radius·shadow 견본. `tokens.css`와 1:1입니다.

### 01 캔버스 · 팔레트 + 체인 레인 (1440×900)
- **팔레트 240**: `--surface` · border-r 1 `--hair` · pad 18/14. 로고(24 ink 타일 + Bricolage 17/700) → "위젯 7" 라벨 → 위젯 행 7개 → 하단 사용자(30 원 아바타 + 이름 12.5/600 + mono 크레딧).
  - 위젯 행: radius 10 · pad 9/8 · gap 11 · 32 원색 아이콘 타일(radius 9, 아이콘 흰 채움 + ink 1.8 스트로크) · 이름 13/600 · 둘째 줄 11px(평소 = `💎 n` `--mute`, 상태가 있으면 6px 점 + 상태 문구, 진행 중은 점이 깜빡임). 선택/작업 중 행 bg `--fill`.
- **툴바**(화면 고정, top 20): 흰 pill 버튼들(border 1 `--line`) — "+ 새 체인", 체인 요약 pill(이름 700 · 1px 구분 · 진행 점 + mono 상태 `--run-fg`), 오른쪽 프로젝트명 `--mute`, 줌 pill(mono).
- **체인 레인**: 흰 면 · border 1 `--line` · radius 16 · `--sh-card`. 헤더 pad 13/18 · border-b `--hair` · "체인 1"(Bricolage 15/700) · 모드 배지(`--fill` pill) · mono 비용 · 오른쪽 "체인 종료" 텍스트.
  - 레인 카드(축소 288×452): border 1 `--line` · radius 12 · 헤더 `--tint-*` + 26 아이콘 타일 + 상태 배지. 행 border 1 `--hair` radius 10.
  - 연결선: 완료 구간 1.5px ink 실선 + 6px 화살촉, 진행 구간 1.5px `--run-dot`, 대기 구간 1.5px dashed `#d6d4da`. 산출물 노드 128×150 dashed.

### 02 위젯 카드 (604×900 실치수)
공통 셸: border 1 `--line` · radius 20 · `--sh-card`.
- 헤더 pad 20/24: 40 아이콘 타일 → 제목 Bricolage 24/700 ls −0.6 → 툴바(흰 · 1px `--line` · radius 10 · 셀 `💎n` mono 12/700, ?, 팔레트 점, 확장).
- 서브바 pad 10/24 · border-b `--hair`: 프로젝트 pill(`--fill`, 폴더 아이콘) + 우측 체인 칩(시그널 배지 규칙).
- **셋업**: 단계 행 radius 14 · border 1 `--hair`. 완료 단계 = 24 원 `--ok-bg` + ✓. 열린 단계 = 테두리 `--tint` 계열(`#d9e8fb`), 옵션 카드 2×2 radius 12 · 선택 = border 1 ink + `--tint-*` bg.
- **진행 중**: 파일 행 radius 12 · 30 상태 타일. 진행 중 행 bg `#fbf9ff` line `#e6dffb`, 실패 행 bg `#fffafa` line `--err-line` + 사유 `--err-fg`. 하단 진행 밴드(위 표).
- **완료**: 본문 중앙 정렬 · 64 완료 타일 · 제목 Bricolage 24 · 부연 14/1.7 max-320 · 주 버튼 "전체보기 열기"(확장 아이콘) · "← 파일로 돌아가기" 텍스트.
- 푸터 pad 16/24 · border-t `--hair` · mono 메타 + 버튼.

### 03 풀뷰 · 인터뷰 결과 보고서 (1400×840)
- 사이드바 240(위 표) · 항목 = 24 아이콘 타일 + 13 이름 + 상태 점.
- 헤더 pad 16/26 · `--tint-rose` bg · border-b `#f6e3ea`: 36 타일 · 제목 Bricolage 21/700 + 메타 12.5 `--mute` · 오른쪽 [다운로드 38 원] [공유 보조 pill] [**편집 주 pill**] · 1px 구분 · 닫기 38 원(✕ 1.8 스트로크 `--mute`, 테두리 없음).
- 탭바 pad 0/26 · border-b `--hair` · 활성 = 600 + 2px ink 밑줄.
- 본문 컬럼 700 가운데 · gap 18: eyebrow mono 11 `--rose-text` → 요약 박스(`--tint-rose` · radius 14 · 17/700 리드 + 점 목록) → 섹션 제목 Bricolage 21 → 본문 14.5/1.85 `--ink-2` + 근거 칩 → 수치 카드 3열(border 1 `--hair` radius 12 · 값 Bricolage 28) → 인용.
- 목차 220 · border-l `--hair` · 활성 항목 = 3px `--tone-rose` 막대 + 700.

### 04 라이브러리 · 공유 관리 (1400×760)
- 제품 헤더(흰 · pad 20/28): 제목 Bricolage 24 + 검색 pill 260. 탭 = 활성 2px ink 밑줄 + mono 카운트.
- 필터 줄 pad 14/28: 상태 세그먼트(`--fill` 트랙) · 위젯 드롭다운(1px pill) · 우측 스코프 세그먼트.
- 표 열 헤더 mono 10.5 .08em `--faint`. 행 pad 13/28 · 34 아이콘 타일 · 제목 14/600 + 위젯명 12 `--faint` · 상태 배지 · 액션(보조 pill "링크 복사" + 텍스트 "끄기" `--danger`).
- **죽은 행(만료·철회)**: 아이콘 타일 `--fill` + 아이콘 `--faint`, 제목 `--mute`, 링크 복사 비활성(`--disabled-fg`). 철회 행은 액션 "—".

### 05 공개 공유 · 모달 · 피커
- **공개 화면**: `--canvas` bg · 흰 상단바(1px `--hair`) · 산출물 종류 배지(`--tint-rose` + 원색 점) · 제목 Bricolage 28 · 카드 radius 14 · 하단 mono 워터마크 줄.
- **확인 모달 440**: radius 18 · `--sh-modal` · 제목 18/700 + 설명 13.5 `--mute` · 대상 카드(`--surface-2`, 1px `--hair`, radius 12) · [취소 보조] [링크 끄기 `--danger` 채움]. 닫기 ✕는 테두리 없는 32 원.
- **피커**: 트리거 열림 = border 1 ink + `--focus-ring`, 패널 240 radius 12 `--sh-popover` pad 6 · 행 radius 8 pad 9/10 · 선택 행 `--fill` + 600 + ✓.

## Interactions & Behavior
기존 BUILD-SPEC의 인터랙션을 그대로 유지합니다. 시각 변화만:
- hover: 리스트 행·사이드바 항목 bg `--surface-2`. 보조 버튼 border `#d6d4da`. 주 버튼 bg `#2e2b33`. 전환 120ms ease-out.
- focus-visible: 컨트롤 border `--ink` + `--focus-ring`. 하드 그림자로 포커스를 표시하지 않습니다.
- 진행 점 깜빡임: opacity 1 → .35 → 1, 1.4s ease-in-out 무한(`sipulse`). running 상태에만. `prefers-reduced-motion`이면 꺼짐.
- 잠금(disabled): 래퍼 opacity를 쓰지 않습니다. bg `--fill`, 글자 `--faint`, 테두리 없음.

## State Management
변경 없음. 기존 컨테이너·계약 그대로입니다.

## Design Tokens
`tokens.css`가 전부입니다. Tailwind `theme.extend`에 매핑하세요(예: `colors.tint.rose`, `boxShadow.card`, `borderRadius.panel`). 기존 Memphis 토큰(`shadow-memphis-*`, `border-frame` 등)은 **이 작업이 끝나면 0건**이어야 합니다.

## Assets
- 폰트: Pretendard(CDN, 기존), **Bricolage Grotesque 600–800 · JetBrains Mono 500–700 추가**(Google Fonts 또는 self-host). 한글 제목은 Bricolage에 글리프가 없어 Pretendard로 폴백되는 것이 의도입니다.
- 아이콘: 레포의 `iconography-duotone` 세트를 그대로 씁니다. 원색 타일 안에서는 채움 흰색 + ink 스트로크(SSOT §A5 규칙 유지), 스트로크 굵기만 2 → **1.8**로 낮춥니다. 컴프 속 아이콘은 자리표시입니다.
- 💎는 크레딧 표기용 예외로 유지합니다.

## 작업 순서 권장
> **1–2번 = "리브랜드 1단계"** — 캔버스 모듈화 Phase 1(`design_handoff_canvas_modular_full`)의 **선행 조건**입니다. 1단계를 단독 PR 로 머지한 뒤 Phase 1 이 시작됩니다. 3–6번은 Phase 1 과 병행 가능합니다. 두 작업을 한 PR 로 묶지 마세요.

1. `tokens.css`를 `globals.css`에 넣고 Tailwind에 매핑합니다. 기존 토큰은 아직 지우지 않습니다.
2. **공유 셸부터**: `WidgetShell` → `FullviewShell`(사이드바 포함) → 리스트 표면 셸 → 모달/팝오버/Picker. 셸만 바꿔도 화면의 80%가 바뀝니다.
   — **여기까지 머지하면 1단계 완료.**
3. 위젯 본문 7종(각 위젯의 행·옵션 카드·진행 밴드·빈 상태).
4. 보고서 블록 11종(요약 박스, 인용, 수치, 근거 칩 등).
5. 공개 표면(공유 보기, 옵저버, 일정, 내보내기 문서). 내보내기 문서(인쇄)는 그림자를 쓰지 않습니다.
6. 하드 그림자·두꺼운 보더 grep으로 잔여를 0건으로 만든 뒤 Memphis 토큰을 삭제합니다.

## Done-when
- [ ] `shadow-memphis` · `Npx Npx 0` 형태의 box-shadow grep 0건
- [ ] `border-2` · `border-[1.5px]` · `border-[3px]` · `border-[2.5px]` grep 0건(점선 빈 자리, 탭 밑줄 예외)
- [ ] 원색 파스텔이 64px보다 큰 면에 칠해진 곳 0건(틴트로 교체)
- [ ] 상태 배지에 테두리 0건 · 만료/철회 점 모양 구분 유지
- [ ] 버튼·배지·칩에 그림자 0건
- [ ] Bricolage Grotesque · JetBrains Mono 로드 확인 · 한글 제목 Pretendard 폴백 확인
- [ ] 컴프 단독 렌더와 Playwright 스크린샷 오버레이 diff(셸 단위)

## Files
- `soft-identity-product.dc.html`: 비주얼 SSOT(00 시스템 · 01 캔버스 · 02 카드 3종 · 03 풀뷰 · 04 라이브러리 · 05 공개/모달/피커)
- `tokens.css`: 토큰 전체
- `support.js`: 컴프 실행용 런타임(포팅 대상 아님)
- `reference/rebrand-directions.dc.html`: 비교했던 5개 방향(1a–1e 랜딩, 2a–2e 제품). 채택안은 1e/2e. 참고용입니다.
