# REDESIGN BRIEF — 인터뷰 결과 생성기 (writer → CD 아웃바운드)

> **작성**: spec writer · 2026-08-05. **인풋 세트**: 이 폴더의 `CONTEXT-INTERVIEW-RESULTS.md`(표면 전수) + `REPORT-CONTENT-RULES.md`(보고서 콘텐츠 구조 SSOT — 블록 11종·필수 섹션·SOP가 여기서 나옴).
> **먼저 읽을 공통 SSOT**: `design-handoff/CONTEXT-PACK.md`(토큰 어휘) · `from-cd/tokens.json` **2.0** + `TOKEN-DECISIONS.md`(artifacts-unified 폴더 — 2.0 이 최신) · `design-handoff/CD-DELIVERABLE-RULES.md`(산출물 규칙) · `design-handoff/FULLVIEW-SHELL.md`(§F 공유 풀뷰 셸).
> **역할 경계(규칙 0)**: CD=프레젠테이션(레이아웃·토큰·상태별 정적 모습·문구), 워커=로직/데이터. §D 계약의 typed props 를 받는 dumb 컴포넌트 전제. 계약 밖 필요 → `⚠️ contract-change:` 표기.

## 1. 리디자인 대상 (스코프)

1. **위젯 카드** — idle(프로젝트 선택+업로드) / active(abstract 요약 카드·생성 진행·파일 목록) 전 모드.
2. **전체보기 (본체)** — 프로젝트 상세: 파일 패널 + 탑라인 리포트 뷰 + 검색 탭.
3. **탑라인 리포트 리딩 경험** — 블록 11종의 타이포/아티팩트 트리트먼트, 헤더 액션(내보내기·공유·언어·재생성), 생성 중/빈/에러/stale 상태.
4. **범위 밖**: 공유 공개 뷰어(share-shell 계열, 별도 완료) · 검색 채팅의 대화 UX 자체(리스킨만) · 백엔드/생성 규칙.

## 2. 계약 (이대로 디자인 — SSOT)

- **데이터**: `CONTEXT-INTERVIEW-RESULTS.md §D` 의 `ToplineBlock`(11종)·`ToplineReadResult` — 이 두 타입이 풀뷰가 받는 전부. 카드 abstract 는 blocks 에서 파생(제목·요약·키포인트).
- **콘텐츠 구조**: `REPORT-CONTENT-RULES.md` — 보고서는 항상 executive_summary → 응답자 프로필 → 핵심 요약 → 테마 섹션(질문형 제목, 6개 내외) → 교차분석 → 시사점 순. **각 절은 숫자(표)→의미→인용→액션 리듬** — 이 리듬이 시각 리듬의 근거가 되어야 함 (표·차트·인용이 "섹션 끝 몰아넣기"가 아니라 본문 중간에 유기 배치되는 구조).
- **상태 전수(각각 정적으로 그릴 것)**: 카드 4모드(idle/active-abstract/generating/empty) · 풀뷰 4상태(로딩/생성 중 map·reduce/완료/빈) + stale 배너 + stuck/error + 재생성 모달(방향 입력 ≤600자 + 언어 6종) · 파일 인덱싱 4단(업로드→파싱→청킹→임베딩) · 공유 3액션(Word/Gdoc 진행 토글/초대) · 블록 사이 삽입(hover ＋) · inserted_qa/section pending 카드.

## 3. 쟁점 — CD 판단을 요청하는 지점 (방향 제안 아님, 결정 필요 목록)

1. **셸 세대 교체**: 현행 풀뷰는 구형 `WidgetFullviewPanel` — 다른 5위젯이 쓰는 **§F FullviewShell**(1600×900·240px 사이드바·파스텔 헤더)로 수렴할지. 수렴 시 사이드바 위젯 네비에 자연 편입됨. **권장: 수렴** (셸 파편화 해소) — 단 CD 확정.
2. **정체성 톤 충돌**: 카드 accent `peach` = AI UT 정체성 톤과 중복. 남은 미배정 파스텔 = `rose` (TOKEN-DECISIONS §E — "다음 기능의 정체성"으로 예약됨). 인터뷰 결과에 rose 배정할지 CD 결정.
3. **근거(citations) 노출**: 현행은 inline [chunk_id] 를 strip 하고 근거를 시각적으로 안 보여줌. 리서치 신뢰성 관점에서 "근거 보기" 어포던스(hover/클릭 시 출처)를 디자인할지 — 하면 `⚠️ contract-change` 없이 가능 (citations 배열이 이미 옴).
4. **보고서 리딩 vs 편집 모드**: 블록 사이 hover ＋(섹션 삽입)·drag-to-ask 가 리딩 경험과 섞여 있음 — 읽기/편집을 시각적으로 어떻게 분리할지.
5. **차트 팔레트**: 현행 5색 순환에 임의 hex 2개 — tokens 2.0 어휘로 재정의 필요 (chart.* 토큰 신설 = `proposed-token:` 대상).

## 4. 산출물 요청 (CD-DELIVERABLE-RULES §1 세트 → 이 폴더 `from-cd/` 에)

- `interview-results.dc.html` — 카드 4모드 + 풀뷰 4상태 + stale/에러 + 재생성 + **블록 11종 전부가 등장하는 완료 보고서 프레임 1장** (executive_summary·표·차트·파이·인용·inserted_qa 포함) 정적 프레임들.
- `interview-results-BUILD-SPEC.md` — §1 클래스맵(diff 대상)·상태 트리거·문구. 블록 타입별 트리트먼트 표 필수.
- `GEOMETRY.md` — 실측 (셸 수렴 시 §F 값 참조로 갈음 가능).
- 공통 규칙: hex/임의값 0(신규는 `proposed-token:`) · 전 상태 정적 · typed props 전제 · 인터랙션은 문구로.

## 5. 다음 단계 (참고)

CD 번들 인바운드 → writer 가 `from-cd/` 커밋 → 워커 통합 스펙(프레젠테이션 fresh + 기존 훅/로직 재사용) → 픽셀 diff 게이트 → 프리뷰 확인 → 머지. 백엔드 계약 변경이 필요해지면(`⚠️ contract-change:`) writer 가 계약 갱신 후 양 트랙 전파.
