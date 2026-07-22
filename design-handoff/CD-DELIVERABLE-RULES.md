# CD 산출물 규칙 — Claude Design 이 지켜야 할 것 (핸드오프 계약)

_작성: spec writer · 2026-07-21 · CD 가 디자인 산출물을 만들 때 매번 따르는 규칙. 목표 = **번역비용 0 + conformance 검증 가능**. 토큰 어휘 SSOT = `CONTEXT-PACK.md` + `tokens.json`(이 문서는 그걸 중복하지 않고 참조)._

## 0. 역할 경계 (제일 중요)
- **CD = 프레젠테이션(비주얼) 레이어 소유.** 레이아웃·토큰·스타일·상태별 정적 모습·문구.
- **워커 = 로직/데이터 레이어 소유.** 데이터 페칭·상태관리·API·이벤트 핸들러·실시간·애니메이션 구현.
- CD 산출물은 워커가 **거의 기계적으로 TSX 로 옮기고 배선**만 하면 되도록 나와야 한다. "예쁘게" 가 아니라 **"이 클래스/이 값으로"** 명시.

## 1. 산출물 세트 (핸드오프 1건 = 아래를 `design-handoff/<feature>/from-cd/` 에 담는다)
1. **`<feature>.dc.html`** — 목업. **반드시 제품 유틸리티 클래스로**(아래 §2). 인라인 hex/px ❌.
2. **`<feature>-BUILD-SPEC.md`** — 레이아웃·상태·문구 스펙(§4~5). self-contained, 날짜·SSOT 명시.
3. **(커스텀 프레임/지오메트리면) `GEOMETRY.md`** — 실측 px/토큰, "해석 오차 0" 수준(예: `604×900 · border 3px ink · radius 20 · shadow 4px4px0 · 콘텐츠 컬럼 514`).

## 2. 어휘 규칙 — 토큰/유틸리티 클래스만 (SSOT: CONTEXT-PACK §1~4)
1. **hex/px/폰트명 직접 쓰지 마라 — 유틸리티 클래스로.** `class="bg-amore rounded-sm shadow-memphis-md text-ink"` 형태. 인라인 `#ff5c8a` ❌ → `bg-amore` ✅.
2. **기존 토큰으로 표현 가능하면 무조건 토큰.** 새로 만들지 말고 재조립.
3. **의도적 신규(브랜드 탐색 등)는 발명하되 라벨링:** `proposed-token:` 컨벤션으로 명시(hex 몰래 쓰기 ❌). → 규칙상 토큰 PR 로 승격. **발명 금지가 아니라 발명 표기.**
4. Memphis/그림자/보더는 정해진 유틸(`shadow-memphis-*`, `border-ink` 등)만. `shadow-[..]` 임의값 ❌.

## 3. Conformance-first — 워커가 대조 가능하게
- 모든 시각 요소 = **명시적 클래스 or 실측 지오메트리**. 워커가 자기 TSX 를 `.dc.html`/GEOMETRY 와 **diff 해서 일치 검증**할 수 있어야 한다.
- "적당히 정렬/여백" ❌ → 실제 클래스(`gap-3`, `px-5`, `justify-between`)로.
- 색/폭/모서리/그림자에 **모호함 0**. (V2 사고 원인 = 스펙은 맞았는데 구현이 이탈 → 대조 가능하게 만들어 이탈을 잡는다.)

## 4. 상태 커버리지 — 전 상태를 정적으로 (CD 는 앱을 못 돌린다)
`.dc.html` 은 정적이므로, 런타임에 바뀌는 **모든 상태를 각각 정적 모습으로** 제공:
- idle / loading·progress / **error** / **empty** / done·success / hover / focus / **disabled** / selected / (해당 시) live·streaming.
- 특히 **비활성(disabled)·에러·빈 상태**를 빠뜨리지 마라 — 빠지면 워커가 추측 → drift.
- 각 상태의 트리거·전이는 BUILD-SPEC 에 **문구로** 기술("값 입력 완료 → 요약행", "실패 → warning 박스").

## 5. 프레젠테이션 경계 + 계약 준수
- **writer 가 준 prop/데이터 계약대로** 디자인하라. 컴포넌트는 **typed props 를 받는 dumb** 형태를 전제 — 데이터 페칭·API·전역상태 가정 ❌.
- 인터랙션은 **"무엇이 일어나는가"만 문구로**(클릭→X, 토글→Y). **로직 구현은 워커 소유** — CD 가 로직/조건분기를 코드로 짜지 마라.
- **계약에 없는 prop/데이터가 필요해지면** → 조용히 발명하지 말고 BUILD-SPEC 상단에 **`⚠️ contract-change: <필요한 것> — <이유>`** 로 명시. writer 가 계약을 갱신·양 트랙에 전파한다.

## 6. 인터랙션 한계 (정직하게)
- 드래그·실시간·트랜지션·애니메이션은 `.dc.html` 로 표현 못 함 → **관련 정적 상태들 + 동작 스펙(문구)** 로 대체. 가짜 인터랙티브로 오해를 유발하지 마라.
- 모션이 디자인 의도의 핵심이면(예: StageFlow 펄스) → 시작/중간/끝 프레임 + 타이밍·이징을 **문구/토큰**으로 기술(`transition-transform`, 펄스 = `proposed-token`).

## 7. Self-contained · 버전
- 각 BUILD-SPEC 는 **자기완결**(그것만 읽고 구현 가능). 상단에 **날짜 · SSOT(`.dc.html` 파일명) · 리비전이면 무엇이 바뀌었는지**.
- 재작업(reconcile)이면 **이전 대비 델타만** 명확히(무엇을·왜).

## 8. 핸드오프 메커니즘
- **인바운드(CD→writer):** 위 산출물을 `design-handoff/<feature>/from-cd/` 에 md/.dc.html 로 담는다. writer 가 읽어 워커 통합 스펙으로 변환.
- **아웃바운드(writer→CD):** writer 가 `design-handoff/<feature>/` 에 context/prop 계약 + 이 규칙을 둔다. CD 는 **CONTEXT-PACK + 이 규칙 + prop 계약**을 먼저 읽고 시작.

---
## 한 줄 체크리스트 (CD 가 핸드오프 전 자문)
- [ ] hex/임의 px 0, 전부 유틸리티 클래스 (신규는 `proposed-token:` 표기)
- [ ] 전 상태(에러·빈·disabled 포함) 정적으로 다 그림
- [ ] 워커가 diff 로 대조 가능한 명시성 (모호함 0)
- [ ] typed props 전제, 데이터/로직 가정 없음 · 계약 밖 필요는 `⚠️ contract-change:` 로 표기
- [ ] 인터랙션은 정적 상태+문구로 (가짜 인터랙티브 ❌)
- [ ] `from-cd/` 에 self-contained + 날짜·SSOT 로 담음
