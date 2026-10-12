# WRITER-ANSWERS — 리브랜드 묶음 검토 회신

_2026-10-12 · writer · 사용자 확정("리브랜드 진행 — 지금 디자인은 전반적으로 정신없음") 접수. 세 스펙의 계약 SSOT 에 반영._

| # | 항목 | 판정 |
|---|---|---|
| 1 | **번들 간 치수 충돌 — 리브랜드 컴프 01 장면의 레인 카드 288×452** | **포팅 금지.** 묶음 자체 우선순위 규칙("구조·치수·상호작용은 리브랜드와 무관 — 리브랜드는 시각 값만")에 따라 **치수 SSOT = canvas-modular/full + widget-chain/v3 (레인 카드 실치수 604×900, 축소 없음 — 사용자 확정 결정 1)**. 리브랜드 01 장면의 축소 카드는 1440×900 프레임용 연출. 워커는 soft-identity 컴프에서 **색·선·그림자·radius·타입 값만** 읽는다 |
| 2 | **check:design CI 베이스라인** | Memphis 기준 베이스라인·가드와 리브랜드가 단계마다 충돌 — 각 스펙에 "베이스라인 갱신은 해당 PR 범위" 명시. 신규 토큰(tokens.css)은 1단계에서 등재되므로 raw hex 가드는 자연 통과. **Memphis 토큰 삭제는 2단계(마지막) 전까지 금지** — 공존 기간의 전제 |
| 3 | 폰트 추가 (Bricolage Grotesque · JetBrains Mono) | 1단계 범위. 셀프호스트 vs Google Fonts 는 워커가 기존 Pretendard 로딩 관례 따름. 한글 제목의 Pretendard 폴백 = 의도(README 명시) — 버그 아님 |
| 4 | 작업 순서 | 묶음 README 그대로 채택: **1단계(토큰+공유 셸, 단독 PR) → 캔버스 Phase 1(단독 PR) → 2단계(본문·보고서·공개 표면·Memphis 삭제, Phase 1 과 병행 가능)**. 한 PR 로 묶기 금지 — 시각 회귀와 동작 결함 분리 |
| 5 | 체인 v3 픽셀 diff 오라클과의 관계 | 1단계 머지 후 v3 `.dc.html` 의 Memphis 값은 **외형 SSOT 지위를 상실** — 레인 chrome 의 새 값 SSOT = canvas-modular/full §5. 구조·상태 문법 SSOT 로는 유효 유지 |
