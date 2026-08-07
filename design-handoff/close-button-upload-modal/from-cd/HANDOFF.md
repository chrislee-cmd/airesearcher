# HANDOFF — 닫기 버튼 정리 + 업로드 모달 리스타일 (CD → worker)

> **읽는 순서의 시작점입니다.**
> **CD:** Claude Design · 2026-08-07. **인바운드 인풋:** 사용자 제공 스크린샷 2장(업로드 모달 · 카드 내 진행 배너).

## 0. 이 폴더에 뭐가 있나

| 파일 | 역할 |
|---|---|
| `HANDOFF.md` | 이 문서. 진입점 · 읽는 순서 · 포팅 절차 · done-when |
| `CLOSE-BUTTON-AUDIT.dc.html` | **비주얼 SSOT.** 현재/교체안 대조 · 변종 4종 × 2상태 · 모달 before/after. 브라우저에서 그냥 열립니다 |
| `close-button-BUILD-SPEC.md` | **계약 A — 전역 컴포넌트.** 변종 4종 토큰표 · 상태 매트릭스 · 적용 지점 · 마이그레이션 절차 |
| `upload-modal-BUILD-SPEC.md` | **계약 B — 한 화면.** 업로드 모달 6건 리스타일 · 파일 행 구조 · 진행 배너 |
| `support.js` | `.dc.html` 단독 실행용 런타임. **빌드 산출물이 아닙니다** — 포팅 대상 아님 |

## 1. 읽는 순서

1. **이 문서** — 전체 지형과 절차.
2. **`CLOSE-BUTTON-AUDIT.dc.html` 상단 "범위" 박스** — **여기를 건너뛰면 잘못 고칩니다.** 무엇을 바꾸고 무엇을 그대로 두는지가 한 문단으로 있습니다.
3. **`close-button-BUILD-SPEC.md`** — 계약 A. 먼저 이것만 끝내세요.
4. **`upload-modal-BUILD-SPEC.md`** — 계약 B. A 가 머지된 뒤에.
5. 치수가 필요하면 `.dc.html` 을 열어 해당 프레임을 보세요.

### 이 폴더 밖에서 읽어야 하는 것 (공통 SSOT, 이미 리포에 있음)
`DESIGN-SSOT-MASTER.dc.html`(특히 **§A4 보더 · §B2 그림자 · §B3 radius · §D1 버튼 · §D5 아이콘**) · `tokens.json` **2.0** · `WIDGET-SHELL.md` · `CD-DELIVERABLE-RULES.md`.
> 참조는 전부 **파일명 + §** 로만 적었습니다. 이 폴더가 리포 어디로 옮겨져도 링크가 깨지지 않습니다.

## 2. ⚠️ 가장 중요한 한 가지 — 범위

**`✕` 문자 자체는 바꾸지 않습니다.**

`DESIGN-SSOT-MASTER §D5` 가 **`✓ ✕ ■`** 를 "이모지가 아닌 문자·도형"으로 유지하기로 이미 정했고, `interview-results-BUILD-SPEC §1.5` 도 같은 규칙을 따릅니다. **이 번들은 그 판정을 뒤집지 않습니다.**

레거시로 지목하는 것은 **그 문자를 감싼 상자**입니다 — 크기 · 보더 · radius · 색 · hover.

따라서:
- **아이콘 세트(`iconography-duotone/`)에 close 를 추가할 일이 없습니다.** SVG 로 바꾸지 마세요.
- **`✕` 로 grep 하지 마세요** — 유지 대상인 `✓`·`■` 까지 딸려 옵니다. 찾을 것은 §계약 A 3-2 의 상자 지문입니다.

## 3. 포팅 절차

### 3-1. 계약 A 먼저 (전역)
- `close-button-BUILD-SPEC.md` §1 의 **변종 4종**을 하나의 컴포넌트 + `variant` prop 으로 만듭니다.
- **기존 것을 고치지 말고 새로 만든 뒤 호출부를 갈아끼우세요.** 레거시가 어디에 몇 개 남았는지는 그 과정에서 드러납니다 — 사용자가 "다른 곳에도 있다"고 했고, CD 는 두 화면만 봤습니다.
- 교체 전에 **적용 지점 목록을 먼저 뽑아 CD 로 회신**하세요. 스크린샷 2장 밖의 자리는 CD 가 상태를 확인하지 못했습니다.

### 3-2. 계약 B 는 별건
- 업로드 모달 6건은 **이 화면만의 문제**라 A 와 릴리스를 **묶지 마세요**. A 는 전역 컴포넌트 교체(회귀 범위 넓음), B 는 한 화면 리스타일입니다.
- B 안에서 ✕ 는 A 의 컴포넌트를 **호출만** 합니다.

### 3-3. 열린 결정 1건
`upload-modal-BUILD-SPEC.md` §6 — **모달 헤더에 rose 밴드를 쓸지.** 인터뷰 결과 전용이면 rose, 여러 위젯이 공유하면 흰 헤더 + border-b 3px(`DESIGN-SSOT-MASTER §A2` 의 제품 헤더). **B 착수 전에 닫으세요.**

## 4. 안 그린 것 (워커가 지어내지 마세요)

드래그 오버 상태 · 업로드 진행률(파일 단위) · 25MB 초과 거부 · 중복 파일 · 지원하지 않는 확장자 · 되돌리기(제거 취소) · 모달 열림/닫힘 트랜지션.

**상태가 빠졌다고 판단되면 발명하지 말고 CD 로 되돌리세요.**

## 5. done-when 체크리스트

### 계약 A
- [ ] ✕ 컴포넌트 1개 + `variant` 4종(`row-remove` · `dialog-close` · `chip-clear` · `banner-dismiss`)
- [ ] **`✕` 문자 유지** — SVG 로 바뀌지 않았다
- [ ] 히트 영역이 전부 **28×28 이상**(banner-dismiss 24, chip-clear 16 은 §1 의 명시 예외)
- [ ] radius 가 전부 `rounded-icon 9` (chip-clear 만 pill)
- [ ] `#999` · `#d0d0d0` 가 이 컴포넌트에서 **0건**
- [ ] 파괴적 변종(row-remove · chip-clear)만 hover 에서 crimson
- [ ] hover 이전에는 보더가 없다 (dialog-close 제외)
- [ ] 적용 지점 목록을 CD 로 회신했고, 스크린샷 2장 밖의 자리도 반영했다

### 계약 B
- [ ] 프레임 border 3 · radius 18 · `shadow-2xl` **blur 0**
- [ ] 드롭존이 **점선 2.5px** (실선 아님)
- [ ] 파일 행에 **타입 타일 + 용량**이 있고, 목록 헤더에 **총량**이 있다
- [ ] 푸터 버튼이 `DESIGN-SSOT-MASTER §D1` 4단 규격 (그림자 포함)
- [ ] 진행 배너가 `processing` 시그널 (회색 진행바 + 붉은 라벨 폐기)
- [ ] 헤더 결정(§6)이 닫혔다

### 공통
- [ ] 이 표면에서 `rounded-\[` · `shadow-\[` · raw hex grep 0건
- [ ] `prefers-reduced-motion: reduce` 에서 hover 트랜지션이 무력화된다

## 6. 검수

1. **하네스(CI)** — `check:design` hex ratchet.
2. **워커** — PR 전 TSX ↔ BUILD-SPEC §1 대조.
3. **픽셀 diff** — `CLOSE-BUTTON-AUDIT.dc.html` 의 교체안 프레임을 오라클로 Playwright 오버레이.
4. **사람** — 실제 업로드 흐름에서 파일 하나 빼보기(히트 영역 확인은 스크린샷으로 안 됩니다).
