# UPLOAD MODAL — BUILD-SPEC (계약 B · 한 화면)

> **CD SSOT:** `CLOSE-BUTTON-AUDIT.dc.html` §2 (before/after 대조). **작성:** Claude Design · 2026-08-07.
> **범위:** 인터뷰 결과 생성기의 파일 업로드 모달, 그리고 카드 안에 뜨는 업로드 진행 배너.
> **선행:** `close-button-BUILD-SPEC.md`(계약 A)가 먼저 머지되어야 합니다 — 이 모달의 ✕ 는 A 의 컴포넌트를 호출만 합니다.

## §0 왜 별건인가

계약 A 는 **전역 컴포넌트 교체**(회귀 범위가 제품 전체), 이 계약은 **한 화면 리스타일**입니다. 릴리스를 묶으면 A 의 회귀를 이 화면의 변경과 구분할 수 없습니다. **따로 내세요.**

## §1 클래스맵 — 6건

| # | 요소 | 현재 | SSOT | 근거 |
|---|---|---|---|---|
| 1 | 프레임 | border 2px · radius 8 · `0 4px 16px rgba(0,0,0,.14)` | border **3** · radius **18**(`rounded-modal`) · `shadow-2xl` **8px 8px 0 · blur 0** | `DESIGN-SSOT-MASTER §B2 · §B3` |
| 2 | 헤더 | 흰 바탕 · 1px 회색선 · 700 15px | 밴드 + `border-b`(§6 결정) · **Outfit 800 / 17** · 우측에 총량 pill + `dialog-close` | `§A2 · §C1` |
| 3 | 드롭존 | **2px 실선 잉크** — 채워진 영역처럼 읽힘 | **2.5px 점선** `line-empty #c9ccd2` + 업로드 아이콘 타일(44 · border 3 · `shadow-md`) | `§D4` |
| 4 | 파일 목록 | 1px `#ddd` · radius 3 · 구분선 `#eee` | border **strong 2** · radius **panel 12** · `shadow-md-faint` · 구분선 **hair** `ink/8` | `§A4 · §B3` |
| 5 | 행 | 파일명만 · 45px · 타입/용량 없음 | **타입 타일 24(rose, border-thin, radius 8) + 이름 + 용량 mono + `row-remove`** · 목록 헤더에 **총 개수 · 총량** | `§C3` |
| 6 | 푸터 | 1px 회색선 · 세컨더리 무그림자 | `border-t` **2px** · 버튼 4단 규격(세컨더리 thin + `shadow-sm-faint` / 프라이머리 ink + `shadow-sm`) · 좌측에 후속 처리 안내 mono | `§D1` |

## §2 파일 행 구조

```
[타입 타일 24] [파일명 flex · 12px · ellipsis] [용량 mono 10 · mute-soft] [row-remove 28]
```

- 행 높이 **42**(padding 9 + 타일 24)
- hover 시 행 배경 `surface.canvas #fbfbf9`
- **타입 타일이 필요한 이유:** 목록이 열 줄을 넘어가면 파일명만으로는 훑기 어렵습니다. 타일 색은 위젯 정체성 톤(인터뷰 = rose), 글리프는 `iconography-duotone/` 의 파일 아이콘.
- **용량이 필요한 이유:** 25MB 제한이 업로드를 눌러야 걸리면 늦습니다. 목록 헤더의 총량이 제한에 근접하면 amber 로 전환(임계값은 §6).

목록이 길면 **접기**: 4행 노출 + `＋ N개 더` (mono 10 · `mute-soft` · `surface.canvas` 바탕).

## §3 진행 배너 (두 번째 스크린샷)

카드 본문 상단에 뜨는 업로드 진행 표시.

| Prop | 현재 | SSOT |
|---|---|---|
| 프레임 | 회색 박스 | border **2px ink** · radius **11** · `shadow-md-processing` **3px 3px 0 violet/35** |
| 배경 | 흰색 | `signal.processing.bg` **#f6f2ff** |
| 라벨 | 붉은 "변환 중 10" | `signal.processing.text` **#6b4aa0** · mono 10.5 / 700 |
| 도트 | 없음 | 7px `#8b5cf6` |
| 카운트 | `0/10` 좌하단 | 우측 mono 11 / 800 `processing.text` |
| 진행바 | 회색 트랙 | 트랙 `ink/10` · 채움 `#8b5cf6` · h7 · pill |
| 닫기 | 레거시 ✕ | `banner-dismiss` (계약 A · D) |

**현재의 문제:** 회색 진행바 + 붉은 라벨이라 **진행 중인지 실패인지 읽히지 않습니다.** `processing` 시그널로 통일하면 다른 여섯 위젯의 진행 표시와 같아집니다(`DESIGN-SSOT-MASTER §B1` — processing 이 lav 파스텔과 다른 색인 이유도 같은 문단에 있습니다).

## §4 상태

| 상태 | 그림 | 비고 |
|---|---|---|
| 빈 모달 | 드롭존만 · 목록 없음 · 업로드 버튼 disabled | `§D4` 빈 상태 |
| 파일 선택됨 | 드롭존 + 목록 + 총량 | 기본 |
| 총량 임계 근접 | 목록 헤더 총량이 amber | 임계값 §6 |
| 업로드 중 | 모달 닫히고 카드에 진행 배너 | §3 |
| 실패 | **CD 미설계** | §5 |

## §5 안 그린 것

드래그 오버 · 파일 단위 진행률 · 25MB 초과 거부 · 중복 파일 · 미지원 확장자 · 제거 되돌리기 · 열림/닫힘 트랜지션.

**발명하지 말고 CD 로 되돌리세요.**

## §6 열린 결정 — **착수 전에 닫으세요**

1. **모달 헤더에 rose 밴드를 쓸지.**
   - 인터뷰 결과 **전용** 모달이면 → **rose 밴드 + `border-b` 2px** (`§A2` 기능 헤더)
   - 여러 위젯이 **공유**하는 모달이면 → **흰 헤더 + `border-b` 3px** (`§A2` 제품 헤더)
   - `.dc.html` 의 after 프레임은 전자로 그렸습니다. 후자라면 CD 가 다시 그립니다.
2. **총량 amber 임계값.** 25MB 의 몇 %인지 (CD 제안: 80%).
3. **접기 임계 행 수.** CD 제안: 4행.
