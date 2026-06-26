# DPA — Anthropic (Claude)

- **Provider 본사**: Anthropic, PBC (US)
- **Source URL**: https://www.anthropic.com/legal/dpa
- **계약 형식**: standalone DPA — Anthropic console → Plan / Billing → "Data Processing Agreement" 에서 PDF 다운로드 + 디지털 서명 (DocuSign 류).
- **서명 / 수락**: TODO — legal 팀이 signed PDF 를 `dpa-anthropic-signed-<YYYY-MM-DD>.pdf` 로 commit
- **버전**: TODO (PDF 첫 페이지 의 effective date / version 기록)

## EU SCC (Standard Contractual Clauses)

DPA 본문 Schedule 3 ("Cross-border data transfer mechanisms") 에 **EU Commission Implementing Decision 2021/914 Module 2 (controller → processor)** + UK addendum (UK IDTA) 포함. Anthropic 의 영국·EU 데이터 처리 시 자동 적용. 별도 SCC 체결 불필요.

## EU-US DPF (Data Privacy Framework)

Anthropic 은 EU-US DPF 인증 보유 — https://www.dataprivacyframework.gov/ 에서 verify. SCC 와 함께 이중 보호.

## Zero Data Retention 상태 (기본)

| 엔드포인트 | 기본 retention | 비고 |
|---|---|---|
| `/v1/messages` (모든 Claude API) | **zero-retention by default** | input/output 학습·로깅 미사용. usage 로그 (token count 만) 30일 보존 — PII 미포함 |
| Batch API | input 24h (배치 완료까지) → 자동 삭제 | 우리는 미사용 |

Anthropic Messages API 는 per-call `store` 플래그가 없습니다 — 기본 zero-retention 이라 필요 없음. PR-SEC10 의 코드 변경은 **OpenAI 쪽 `store: false` 한정**.

추가 조치 (PR-SEC10): `providerOptions.anthropic.metadata.userId` 등 PII 가 들어갈 수 있는 필드를 사용 안 함 (코드 grep 으로 확인됨). Anthropic 측에 남는 정보는 token count + timing 뿐.

## Incident notification

DPA §6: Anthropic 이 침해 **인지 후 72시간 이내** 통지. 이메일 = Anthropic console 의 admin email (현재: chris.lee@meteor-research.com).

## Data subject rights (DSR) 위임

Anthropic 측이 보존하는 사용자 데이터 = 0 (zero-retention) 이라 DSR 위임이 사실상 불필요. 메타데이터 (org_id / 사용량 합계) 만 보존 — 이건 우리 (controller) 결제 컨텍스트라 GDPR 상 legitimate interest.

## 다음 검토 시점

- 매년 또는 Anthropic DPA URL 의 버전 변경 시 (분기별 manual check)
