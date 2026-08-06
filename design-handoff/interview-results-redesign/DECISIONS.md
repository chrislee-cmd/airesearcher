# DECISIONS — interview-results-redesign (writer 확정, 2026-08-05)

> CD 번들(from-cd/, 2026-08-05)의 `⚠️ contract-change` 5건 + 통합 설계 결정. **이 파일이 결정 SSOT** — 워커 스펙들과 CD 후속이 이걸 따른다. CD 결정 5건(§0: 셸 수렴·rose·citations 노출·모드 분리·chart-cat)은 **전부 수용** — 브리프 §3 요청에 대한 응답이 정확했음.

## contract-change 5건 결정

| # | 항목 | 결정 |
|---|---|---|
| 1 | 근거 청크 본문 (팝오버) | **✅ 계약 확장 승인 — full 팝오버로 간다.** 신규 `POST /api/interviews/v2/chunks/resolve` `{project_id, chunk_ids[]}` → `[{chunk_id, excerpt(≤300자), file_name, position}]`. org 스코프 검증, 배치 상한 20. 근거 노출은 이 리디자인의 핵심 가치라 축소판(칩만) 채택 안 함. 단 **점진 배선 허용**: API PR(D)와 UI PR(C1)이 분리되므로, C1 머지 시점에 D 미머지면 칩만 렌더→D 머지 후 팝오버 활성 (기능 플래그 아닌 단순 fetch 실패 폴백). |
| 2 | 남은 시간 ("약 N분 남음") | **❌ 삭제 — 진행률만.** reduce 구간 예측 불가로 ETA 는 거짓 정밀도. CD 확인대로 삭제해도 레이아웃 성립. |
| 3 | stuck 판정 임계값 | **기존 코드 상수 재사용** — 코드베이스의 topline stale/stuck 상수(6분 계열)를 찾아 그 값을 SSOT 로. 없으면 `360_000ms(6분)` 신설. 컴프의 "17분째"는 예시 문구 — 분 단위 변수 렌더. |
| 4 | 공유 열람 수 ("연 사람 4명") | **❌ 미렌더.** shared_views 에 열람 카운트 컬럼이 없음. 레이아웃 무영향(CD 확인). 열람 추적은 별도 티켓 후보로 보류. |
| 5 | 파일↔청크 역참조 | **범위 밖 확정.** 역인덱스 계약 없음 — 필요성이 실사용에서 확인되면 별도 티켓. |

## 통합 설계 결정 (writer)

- **PR 분해 6개** (아래 표) — 토큰/아이콘 파운데이션을 선행 분리해 UI PR 들이 2.0+신규 토큰 위에서 drift 없이 빌드.
- **아이콘 소스**: `iconography-duotone/` 세트는 레포에 아직 없음 → **이 표면이 쓰는 아이콘의 SSOT = `from-cd/interview-results.dc.html` 인라인 SVG 경로** (신규 3종 포함). 파운데이션 PR 이 공용 아이콘 컴포넌트로 추출, 채움은 `--icon-fill` 변수 주입(하드코딩 hex 금지 — BUILD-SPEC §1.5 정정 반영 #ffd0e2=var(--color-rose)). CD 풀세트 번들 인바운드는 후속(§6-5a·b는 그때 정리).
- **셸 프로젝트 pill 📁→`project` 아이콘** (§6-5c): 공유 셸 1곳 수정으로 6위젯 동시 정리 — 파운데이션 PR 에 포함 (인터뷰만 따로 고치지 않음, CD 지시 그대로).
- **보고서 작성 규칙(프롬프트) 무변경**: 헤딩 번호 chip(순번)·insight 라벨("발견"/"대조 N")·quote attribution 표시 형식은 전부 **렌더러 소관**으로 구현 (프롬프트 산출 스키마 그대로). attribution 을 CD 형식("그룹 R번호 · 나이/성별 · 조건")으로 강제하는 프롬프트 갱신은 실렌더 관찰 후 후속 판단 — 지금 건드리면 topline 재생성 품질 회귀 리스크. |
- **Desk exec-head `rose-bg` 중복** (§6-1): CD 판단대로 현상 유지. 관찰 항목.
- **사이드바 8번째 위젯 문제** (§6-2): 7개까지 검증됨 — 8개째 필요 시 §F2 개정 티켓.
- **인쇄/Word 매핑** (§6-3): 범위 밖 — export-documents 블록 매핑은 별도 티켓 후보.

## PR 지도

| PR | 내용 | 의존 |
|---|---|---|
| A `pr-iv-redesign-foundation` [S·FS] | 토큰 승격 4종+chart-cat 6종 · 듀오톤 아이콘 공용화(신규 3종 포함) · 셸 📁→project | — |
| D `pr-iv-citations-resolve-api` [S·BE] | 청크 resolve API (결정 #1) | — (A와 병렬) |
| B `pr-iv-card-redesign` [M·UI] | 카드 본문 fresh (S1 5모드+ambient, rose) | ← A |
| C1 `pr-iv-fullview-shell-read` [L·UI] | 풀뷰 셸 수렴+7번째 사이드바+읽기 모드(블록 11종·칩/팝오버·배너·상태 전수) | ← A (D 는 소프트) |
| C2 `pr-iv-edit-mode-modals` [M·UI] | 편집 모드(SectionGap·drag-to-ask)+재생성/공유 모달 | ← C1 |
| C3 `pr-iv-list-search-reskin` [S·UI] | 프로젝트 목록·검색 리스킨 | ← C1 |
