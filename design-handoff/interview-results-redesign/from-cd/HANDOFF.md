# HANDOFF — 인터뷰 결과 생성기 리디자인 (CD → worker)

> **읽는 순서의 시작점입니다.** 여기부터 읽고 아래 순서대로 내려가세요.
> **CD:** Claude Design · 2026-08-05. **인바운드 인풋:** `REDESIGN-BRIEF.md` · `CONTEXT-INTERVIEW-RESULTS.md` · `REPORT-CONTENT-RULES.md`.

## 0. 이 폴더에 뭐가 있나

| 파일 | 역할 |
|---|---|
| `HANDOFF.md` | 이 문서. 진입점 · 읽는 순서 · 포팅 절차 · done-when |
| `interview-results.dc.html` | **비주얼 SSOT.** 정적 프레임 24장(S1–S6). 브라우저에서 그냥 열립니다 |
| `interview-results-BUILD-SPEC.md` | **계약.** §0 CD 결정 5건 · §1 클래스맵(diff 대상) · §2 proposed-token/icon · §3 상태 매트릭스 · §4 인터랙션 면책 · §5 contract-change · §6 열린 항목 |
| `GEOMETRY.md` | 실측 + 산술 근거(폭 계산·수직 리듬·skeleton 치수) |
| `support.js` | `.dc.html` 를 단독으로 열기 위한 런타임. **빌드 산출물이 아닙니다** — 포팅 대상 아님 |

## 1. 읽는 순서

1. **이 문서** — 전체 지형과 절차.
2. **`interview-results-BUILD-SPEC.md` §0** — CD 결정 5건. 브리프 §3이 요청한 판단이 여기서 닫힙니다. **§0을 건너뛰면 나머지가 왜 그런지 알 수 없습니다.**
3. **`interview-results.dc.html`** — 브라우저에서 열고 S1부터 훑기. 인라인 hex/px는 **렌더용**입니다. diff 대상은 BUILD-SPEC §1의 클래스/토큰 칸입니다.
4. **`interview-results-BUILD-SPEC.md` §1** — 클래스맵. 포팅 중 계속 옆에 두는 문서.
5. **`GEOMETRY.md`** — 치수가 필요할 때.
6. **`interview-results-BUILD-SPEC.md` §5** — `⚠️ contract-change:` 5건. **로직 포팅 전에 writer와 닫으세요.**

### 이 폴더 밖에서 읽어야 하는 것 (공통 SSOT, 이미 리포에 있음)
`CONTEXT-PACK.md` · `tokens.json` **2.0** · `TOKEN-DECISIONS.md` · `WIDGET-SHELL.md` · `FULLVIEW-SHELL.md` · `CD-DELIVERABLE-RULES.md` · `iconography-duotone/README.md`.
> 참조는 전부 **파일명 + §** 로만 적었습니다. 이 폴더가 리포 어디로 옮겨져도 링크가 깨지지 않습니다.

## 2. 권한 규칙 (다른 위젯과 동일)

1. **CD가 비주얼 SSOT.** `.dc.html` + BUILD-SPEC이 생김새를 정의합니다.
2. 기존 DS 토큰/클래스는 **편의 어휘**입니다 — CD 값을 이미 그대로 재현하는 곳에서만 씁니다.
3. **충돌하면 CD가 이깁니다.** 그 간극은 DS가 메울 갭(`proposed-token:`)이지, CD 값을 DS 기본값으로 굽힐 사유가 아닙니다.
4. **기존 UI 컴포넌트를 고쳐 쓰지 마세요.** 프레젠테이션은 **새 컴포넌트**로 만들고, 재사용은 **로직/데이터만**(훅 · API · 스키마 · 파싱 · 폼).

## 3. 포팅 절차

### 3-1. 먼저 닫아야 하는 것
- **BUILD-SPEC §5 contract-change 5건**을 writer와 정리. 그중 3건(남은 시간 · stuck 임계값 · 공유 열람 수)은 **삭제해도 레이아웃이 성립하도록** 그렸으니, 계약을 늘리지 않기로 하면 그 요소만 렌더하지 않으면 됩니다.
- **§2 proposed-token 4종 + proposed-icon 3종**을 CD로 회부해 승격. `globals.css` 에 직접 추가하지 마세요.

### 3-2. 셸
- **풀뷰는 `FULLVIEW-SHELL.md §F` 의 공유 `<FullviewShell>` 에 올립니다.** 구형 `WidgetFullviewPanel` 경로는 버립니다. 사이드바는 **공유 chrome 이므로 인터뷰용으로 다시 구현하지 않습니다**(`§F7-3`).
- 사이드바 항목이 6 → **7개**가 됩니다. 항목 높이·간격은 그대로, 개수만 늘리세요(수용 검증 = `GEOMETRY.md §B2`).
- 카드는 공유 `<WidgetShell>` 그대로. 인터뷰가 추가하는 건 **본문뿐**입니다(BUILD-SPEC §1.1).

### 3-3. 정체성
- 카드/풀뷰 헤더 · 사이드바 도트 · 팔레트 아이콘 = **rose `#ffd0e2`**. peach는 AI UT로 되돌립니다.
- 크레딧 `💎10` · 글리프 `✦`.

### 3-4. 보고서 본문
- 블록 렌더러는 BUILD-SPEC **§1.3 표(11종)** 가 계약입니다. 타입별로 프레임/타이포/토큰이 다 적혀 있습니다.
- **`.dc.html` 좌측 거터의 mono 라벨(`exec summary`, `para`, `table`…)은 컴프 주석입니다. 구현하지 마세요.** 대신 본문 컬럼은 **764px 고정, 가운데 정렬**입니다(`GEOMETRY.md §C1` — 830으로 늘리면 줄당 글자수가 깨집니다).
- 파일 패널은 **status=done 에서 기본 접힘(56px)**, 그 외엔 펼침(300px). 목차 rail(220px)은 done 에서만 렌더. 근거는 폭 산술 `GEOMETRY.md §B1`.

### 3-5. 아이콘
- UI 컨트롤 글리프에 **이모지를 쓰지 않습니다**(`tokens.json` iconography). 전부 `iconography-duotone/` 세트의 인라인 SVG입니다 — 매핑표 = BUILD-SPEC **§1.5**.
- 세트에 없는 3종(`download` · `regenerate` · `dataset`)은 세트 규격대로 그려 `.dc.html` 에 인라인으로 넣었고, 경로를 BUILD-SPEC §2 A-2에 적었습니다. **세트에 추가하고 거기서 가져다 쓰세요.**
- 채움값은 `#ffd0e2`(tokens 2.0 rose). 세트의 하드코딩 `#ffd7e4` 와 다릅니다 — BUILD-SPEC §6-5.
- 유지되는 것: `💎`(WIDGET-SHELL §S1 명시 예외) · `✦`(widget_glyphs) · `✓ ✕ ■`(문자·도형).

### 3-6. 정리 대상 (임의값 삭제)
`w-[132px]` → `--iv-lang-select-w` · `grid-cols-5` → 300px 단일 열 목록 · `h-60` → 행 기반 자동 높이 · 차트 hex `#f97316`·`#a855f7` → `chart-cat-*` · skeleton 임의 높이 → `GEOMETRY.md §D3`.
포팅이 끝나면 이 표면에서 `rounded-\[` · `shadow-\[` · raw hex 를 grep 했을 때 **0건**이어야 합니다.

## 4. 안 그린 것 (워커가 지어내지 마세요)

업로드 진행률(파일 단위) · 25MB 초과 거부 · 보고서 업로드(파일→블록 변환) 흐름 · ja/zh/th 재렌더 프루프 · 크레딧 부족 · 공유 공개 뷰어(`share-shell` 계열, 범위 밖) · 인쇄/Word 문서 레이아웃(`export-documents-BUILD-SPEC.md` 가 SSOT, 매핑은 별도 티켓).

**상태가 빠졌다고 판단되면 발명하지 말고 CD로 되돌리세요.** 상태 전수는 BUILD-SPEC §3에 있습니다.

## 5. done-when 체크리스트

- [ ] 풀뷰가 공유 `<FullviewShell>` 위에 있고, 사이드바를 인터뷰용으로 재구현하지 않았다
- [ ] 사이드바 7항목이 스크롤 없이 들어간다
- [ ] rose 가 카드·풀뷰·사이드바 도트·팔레트에 일관되게 들어갔고, peach 는 AI UT 에만 남았다
- [ ] 블록 11종이 BUILD-SPEC §1.3 대로 렌더된다 (특히 `quote` 에 italic 없음 · `insight` 좌측 회색선 폐기)
- [ ] 본문 컬럼 764px 고정 · 거터 mono 라벨 미구현
- [ ] status=done 에서 파일 패널 접힘 + 목차 rail 렌더
- [ ] 읽기 모드에 SectionGap ＋ 와 드래그 하이라이트가 **존재하지 않는다**
- [ ] citation 칩이 문장 끝에 붙고, `citations` 가 비면 아무것도 렌더하지 않는다
- [ ] 차트가 `chart-cat-*` 만 쓴다 (단일 계열은 `cat-1` 하나)
- [ ] UI 컨트롤에 이모지가 없다 (`💎`·`✦` 제외)
- [ ] BUILD-SPEC §3 상태 전수가 실제로 도달 가능하다 (error·empty·loading·cancelled 포함)
- [ ] `prefers-reduced-motion: reduce` 에서 애니메이션이 전부 무력화된다
- [ ] 임의값 grep 0건 (§3-6)
- [ ] `⚠️ contract-change:` 5건이 전부 닫혔다

## 6. 검수

1. **하네스(CI)** — `check:design` hex ratchet.
2. **워커** — PR 전 TSX ↔ BUILD-SPEC §1 / GEOMETRY 대조(토큰 정합 · 지오메트리 · 상태).
3. **픽셀 diff** — `interview-results.dc.html` 을 단독 렌더해 Playwright 스크린샷 오버레이 diff. **1차 오라클**이고 코드 감사가 2차입니다.
4. **사람** — 프리뷰 확인.
