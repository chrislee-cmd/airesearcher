# 미해결 부채 (Known Debt)

PROJECT.md가 "타임리스 가이드"라면 이 문서는 **현재 시점의 빚 목록**입니다. 새 세션이 어떤 작업을 우선 집어들지 판단할 때 참고하세요. 항목이 해결되면 commit과 함께 이 표에서 제거합니다.

---

## 미해결 항목

| # | 영역 | 항목 | 영향 | 메모 |
|---|---|---|---|---|
| 1 | 결제 | `/credits` Buy 버튼이 mailto fallback | 신규 사용자 자가 충전 불가, billing@ 수동 처리 | 토스/포트원/Stripe 중 하나 연동 필요. `payments` 테이블 + webhook → `org_credits` 자동 가산 패턴이 자연스러움 |
| 2 | 차감 로직 | scheduler CSV gate가 클라이언트 표시만 | CSV 자동 매칭 5크레딧이 실제로 차감되지 않음 | scheduler CSV 매칭 endpoint에서 `spendCredits('scheduler', ..., 5)` 명시적 호출 추가 |
| 3 | 차감 로직 | interviews 비용 통합 | 헤더는 10크레딧이지만 실제 spendCredits는 변환/분석 분리되어 있을 수 있음 | `/api/interviews/extract`, `/api/interviews/analyze`의 호출 패턴 점검 → 단일 10크레딧 또는 적절한 분배로 정리 |
| 4 | 비용 모델 | quotes(전사록) 길이별 종량제 | 90분 초과 파일도 25크레딧 정액 = 마진 압박 | Deepgram 응답 후 duration 받아 분당 비례 차감, 또는 파일 길이 hard cap |
| 5 | Background 일관성 | desk만 DB-backed jobs, 나머지는 메모리 | 새로고침 시 desk 외 모든 in-flight 작업 손실 | 비즈니스적으로 중요한 generators만 DB로 단계적 이전 (reports, analyzer 우선?) |
| 6 | 운영 | Vercel preview 청소 정책 미정 | "Active Branches"에 stale preview가 누적 | 자동 청소 룰 설정 (Vercel 프로젝트 설정에서 며칠 뒤 만료) 또는 머지 후 hook으로 즉시 삭제 |
| 7 | 마이그레이션 | Supabase 마이그 자동 적용 없음 | 머지 후 production DB와 코드가 어긋날 위험 | CI에 `supabase db push` 스텝 추가, 또는 머지 PR에 마이그 적용 체크리스트 명시화 |
| 8 | i18n | en 번역 일부가 한국어 톤을 직역 | 영문 사용자 경험 저하 | 분석가 톤으로 리라이트 (특히 desk/analyzer/reports 헤더) |
| 9 | 워크스페이스 | drag-drop이 모바일에서 동작 안 함 | 태블릿/모바일 사용자가 kebab 메뉴로만 다룰 수 있음 | pointer-events 기반 fallback 또는 long-press 지원 |

---

## 처리 가이드

- **항목 처리**: PR 머지하면서 commit 메시지에 `Closes DEBT #N` 명시하면 다음 PR에서 표에서 제거
- **신규 부채 추가**: PR 머지하며 알게 된 미해결 이슈는 즉시 표에 행 추가 + commit
- **보관 기준**: 1개월 이상 우선순위 안 잡힌 항목은 GitHub Issue로 빼서 표에서 제거 (이 문서는 "곧 다룰 것" 위주)
