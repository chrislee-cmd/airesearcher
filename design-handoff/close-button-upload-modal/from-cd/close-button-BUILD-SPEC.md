# CLOSE BUTTON — BUILD-SPEC (계약 A · 전역 컴포넌트)

> **CD SSOT:** `CLOSE-BUTTON-AUDIT.dc.html` §1. **작성:** Claude Design · 2026-08-07.
> **범위:** 제품 전체의 닫기·제거 컨트롤. **한 컴포넌트로 수렴합니다.**

## §0 CD 결정

| # | 결정 | 근거 |
|---|---|---|
| 0-1 | **`✕` 문자를 유지한다.** SVG 로 바꾸지 않는다 | `DESIGN-SSOT-MASTER §D5` 가 `✓ ✕ ■` 를 이모지 아닌 문자·도형으로 이미 유지 결정. `interview-results-BUILD-SPEC §1.5` 동일 |
| 0-2 | **변종은 4종.** 그 이상 만들지 않는다 | 가르는 축이 둘뿐 — ① 파괴적인가 ② 주변에 테두리가 이미 있는가 |
| 0-3 | **파괴적 변종만 hover 에서 crimson** | 무언가를 버리는 동작(파일 제거·칩 해제)과 화면을 접는 동작(모달·배너)은 결과가 다름 |
| 0-4 | **평상시 무테**(dialog-close 제외) | 목록 안에 있는 컨트롤이 자기 테두리를 가지면 행 테두리와 겹쳐 이중선이 됨 |
| 0-5 | **최소 히트 영역 28×28** | 현재 15×15. 행 높이 45px 대비 1/3 이라 빗나감이 잦음 |

## §1 변종 4종 — 토큰표

공통: `✕` 문자 · `font-weight 700` · `line-height 1` · flex center · `transition: background .12s, border-color .12s, color .12s`

### A · `row-remove` — 행 제거

| Prop | 값 | 토큰 |
|---|---|---|
| 크기 | 28 × 28 | `control-h-sm` (승격 대기 — §2) |
| radius | 9 | `rounded-icon` |
| 글자 | 15px / 700 | — |
| 기본 배경 | 없음 | `transparent` |
| 기본 보더 | 없음 | — |
| 기본 글자색 | `#8a8693` | `mute-soft` |
| hover 배경 | `#fdf0f0` | `signal.error.bg` |
| hover 보더 | 1.5px `#c2334f` | `border-thin` + `crimson` |
| hover 글자색 | `#c2334f` | `crimson` |

**쓰는 곳:** 업로드 파일 행 · 선택 목록 행 · 첨부 목록. **목록 안에 있어 평상시엔 조용해야 합니다.**

### B · `dialog-close` — 모달 닫기

| Prop | 값 | 토큰 |
|---|---|---|
| 크기 | 32 × 32 | `control-h-md` (승격 대기) |
| radius | 9 | `rounded-icon` |
| 글자 | 16px / 700 | — |
| 기본 배경 | `#fff` | `paper` |
| 기본 보더 | 1.5px `#1d1b20` | `border-thin` |
| 기본 그림자 | `2px 2px 0 ink/12` | `shadow-sm-faint` |
| 기본 글자색 | `#1d1b20` | `ink` |
| hover 배경 | `#fbfbf9` | `surface.canvas` |
| hover 그림자 | `2px 2px 0 #1d1b20` | `shadow-sm` |

**쓰는 곳:** 모달·시트 헤더 우측. **주변에 테두리가 없어 스스로 컨트롤임을 밝혀야 합니다.** 유일하게 평상시 보더를 갖는 변종.

### C · `chip-clear` — 칩 제거

| Prop | 값 | 토큰 |
|---|---|---|
| 크기 | 16 × 16 | — (칩 내부, 예외) |
| radius | 999 | `rounded-pill` |
| 글자 | 11px / 700 | — |
| 기본 | 배경·보더 없음 · `#8a8693` | `mute-soft` |
| hover | 배경·보더 없음 · `#c2334f` | `crimson` |

**쓰는 곳:** 필터 칩 · 태그 안쪽. **칩 자체가 이미 테두리라 상자를 겹치지 않습니다.** 28 예외 — 칩 전체(높이 24~28)가 클릭 대상이고 ✕ 는 그 안의 표식입니다.

### D · `banner-dismiss` — 배너 닫기

| Prop | 값 | 토큰 |
|---|---|---|
| 크기 | 24 × 24 | — |
| radius | 9 | `rounded-icon` |
| 글자 | 13px / 700 | — |
| 기본 | 배경·보더 없음 · `#8a8693` | `mute-soft` |
| hover 배경 | `ink/6` | — |
| hover 글자색 | `#1d1b20` | `ink` |

**쓰는 곳:** 토스트 · 진행 배너 · 안내 밴드. **접는 동작이라 파괴적이지 않습니다** — crimson 을 쓰지 않습니다. 24 예외 — 배너 높이가 낮고 실수로 눌러도 되돌릴 수 있습니다.

## §2 승격 요청 (proposed-token)

`globals.css` 에 직접 추가하지 말고 CD 로 회부.

| 토큰 | 값 | 비고 |
|---|---|---|
| `--control-h-sm` | 28px | **이미 `DESIGN-SSOT-MASTER §A6`(Picker) 에서 요청된 것과 동일 건.** 중복 승격하지 말고 병합 |
| `--control-h-md` | 32px | 동상 |
| `--focus-ring` | (미정) | 동상 — 이 컴포넌트도 포커스 스타일이 없음 |

**세 건 모두 이 번들이 처음 발견한 것이 아닙니다.** §A6 이 "Picker 문제가 아니라 제품 전체의 구멍"이라 적었고, 닫기 버튼이 그 두 번째 증거입니다.

## §3 상태 매트릭스

| 상태 | A row-remove | B dialog-close | C chip-clear | D banner-dismiss |
|---|---|---|---|---|
| 기본 | 무테 · mute-soft | 흰 배경 · thin · shadow-sm-faint | 글리프만 · mute-soft | 무테 · mute-soft |
| hover | error.bg · crimson 테 · crimson | canvas · shadow-sm | crimson | ink/6 · ink |
| active | hover + 그림자 1px 축소 | 그림자 제거 · 1px 내려앉음 | hover 동일 | hover 동일 |
| focus | `focus-ring` (§2 대기) | 동일 | 동일 | 동일 |
| disabled | `disabled` 트랙 · `mute` · 그림자 없음 · **opacity 금지** | 동일 | 동일 | 동일 |

`prefers-reduced-motion: reduce` — transition 전부 `none`.

## §4 인터랙션 면책

CD 는 정적 프레임만 그렸습니다. 아래는 **코드 오너 판단**:

- 제거 확인 유무(파일 행은 확인 없이 즉시 제거하는 것이 CD 가정 — 되돌리기가 없으므로 재업로드가 유일한 복구)
- 키보드: `Enter`/`Space` 활성 · `Esc` 는 dialog-close 에만
- `aria-label` 문구 (예: "In Home 1 제거", "닫기")
- 툴팁 유무

## §5 contract-change

없음. **이 계약은 데이터 계약을 건드리지 않습니다** — 순수 프레젠테이션 교체입니다.

## §6 열린 항목

1. **적용 지점 전수.** CD 는 스크린샷 2장만 봤습니다. 사용자가 "다른 곳에도 있다"고 했으므로, **워커가 목록을 뽑아 CD 로 회신**한 뒤 교체를 시작하세요.
2. **grep 지문.** `✕` 로 찾지 마세요(§0-1). 찾을 것:
   - 색: `#999` · `#d0d0d0` · `#ccc` 계열 하드코딩
   - `border-radius: 2` / `3` (눈금 밖)
   - `width: 15px` 안팎의 고정 크기 컨트롤
   - 1px 실선 회색 보더를 가진 인라인 버튼
3. **`✓`·`■` 는 건드리지 마세요.** 같은 §D5 예외 3종이고, `interview-results-BUILD-SPEC §1.5` 가 "셸 기존 처리 그대로"로 묶어 뒀습니다.
