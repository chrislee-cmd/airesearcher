# Design Handoff System — CD ↔ Worker (운영 가이드)

> **한 줄:** CD(Claude Design)는 디자인을, 워커(Claude Code)는 로직/데이터를 소유한다. 교환은 **이 레포의 `design-handoff/` 하나**로만 이뤄진다. _설정: 2026-07-21._

## 왜 이 시스템인가
CD 환경과 코드 레포는 **격리**돼 있다. CD 는 레포에 직접 못 쓴다. 과거엔 핸드오프가 워커가 못 읽는 곳(오케스트레이션 워크스페이스)에 있어, 워커가 정밀 산출물 대신 **산문 요약**만 보고 구현 → CTA 색·필드 폭·프레임 누락 같은 **fidelity drift** 가 났다. 이 시스템이 그걸 닫는다: **핸드오프를 레포에 상주**시켜 워커가 repo 경로로 정본을 읽는다.

## 역할
| 주체 | 소유 | 위치 |
|---|---|---|
| **CD** | 프레젠테이션(레이아웃·토큰·스타일·상태별 정적 모습·문구) | 격리 환경 → 번들 zip 산출 |
| **writer** | 계약 정의 · 스펙 · **다리(zip→레포 커밋)** · contract-change 해결 | jarvis 오케스트레이션 + 이 레포 |
| **worker** | 로직·데이터·상태관리·API·애니메이션 구현 + **conformance 대조** | 코드 레포 워크트리 |

## 흐름
```
CD (번들 생성)
  └─ 사람이 zip 전달
       └─ writer: unzip → design-handoff/ 커밋 (PR→main)  ← 유일한 다리
            └─ worker: README → HANDOFF → BUILD-SPEC(§1 class map) → .dc.html 자기주도 소비
                 └─ TSX 포팅 + conformance 대조 + 로직 배선
                      └─ PR (Design conformance 체크리스트) → check:design CI → Vercel 프리뷰(사람) → 머지
```
- **아웃바운드(writer→CD):** context/prop 계약을 `design-handoff/<feature>/` 에 두고 사람이 CD 에 전달.
- **인바운드(CD→worker):** CD 번들 → 사람 → writer 커밋 → worker.

## 규칙 SSOT
- **CD 가 따르는 것:** `CD-DELIVERABLE-RULES.md` — 유틸리티 클래스/토큰만(hex 금지, `proposed-token:` 표기) · conformance 가능성 · 전 상태 정적 · 계약 준수(`⚠️ contract-change:`) · 인터랙션 한계.
- **worker 가 따르는 것:** `README.md`(진입점) + 각 `<feature>/HANDOFF.md`(done-when) + PR 템플릿 Design conformance 체크리스트.
- **공유 어휘:** `CONTEXT-PACK.md` + `tokens.json` (토큰 SSOT, feature 별 중복 X).

## Conformance 3층 방어
1. **하네스 (CI):** `check:design`(하드코딩 hex ratchet) · `check:i18n` · `check:korean`. → **토큰 이탈(raw hex) 자동 차단.**
2. **규칙 (worker):** PR 전 자기 TSX 를 BUILD-SPEC §1 클래스·GEOMETRY 실측과 **diff**. → 하네스가 못 잡는 **의미적 이탈**(맞는 토큰인지·지오메트리·누락 상태) 차단. 예: CTA `bg-amore` vs `bg-ink` (둘 다 토큰이라 하네스 통과 → 이 층이 잡음).
3. **사람 (프리뷰):** 최종 머지 전 **Vercel 프리뷰** 로 통합 결과 확인. 프로덕션/비가역 머지는 사용자 명시 확정 후.

## 번들 구조 (feature 당)
```
design-handoff/<feature>/
  HANDOFF.md              ← worker 진입점 (먼저 읽기)
  BUILD-SPEC.md           ← 계약 (§1 class map · §2 proposed-token · §3 state matrix · §5 contract-change)
  Widgets Canvas 1c.dc.html   ← setup/states 비주얼
  Widget Fullviews.dc.html    ← fullview 비주얼
  support.js              ← .dc.html standalone 런타임
  GEOMETRY.md             ← 커스텀 프레임 있을 때만
```
공유(레포 루트): `README.md` · `CONTEXT-PACK.md` · `tokens.json` · `CD-DELIVERABLE-RULES.md` · `HANDOFF-SYSTEM.md`(이 문서).

## Feature 상태
`README.md` 의 status 표 참조. (2026-07-21 기준: probing·interpreter·recruiting = ready for port / transcript·ai-ut·desk = spec pending.)

## 운영 규칙 (writer 측, SSOT = writer CLAUDE.md "Design triage & CD 협업")
- **트리아지:** 요청마다 "워커 폴리시 vs CD 트랙" 역제안 후 스펙.
- **다리:** CD zip 오면 writer 가 이 폴더에 커밋. 업데이트는 델타만.
- **feature 브랜치 전파:** 워커가 integ/* 에서 분기하면 main 의 design-handoff 를 그 브랜치에 present 보장.
