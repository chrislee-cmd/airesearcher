# DPA — OpenAI (API)

- **Provider 본사**: OpenAI, L.L.C. (US)
- **Source URL**: https://openai.com/policies/data-processing-addendum
- **계약 형식**: clickwrap acceptance — OpenAI organization 의 admin 이 dashboard → Settings → Compliance 에서 DPA 수락 시 효력 발생. PDF 다운로드는 같은 화면.
- **서명 / 수락**: TODO — legal 팀이 dashboard 에서 acceptance 기록 + 수락 페이지 캡처를 `dpa-openai-accepted-<YYYY-MM-DD>.pdf` 로 commit
- **버전**: TODO (URL 끝 자동 redirect — accept 시점의 PDF 버전 기록)

## EU SCC (Standard Contractual Clauses)

DPA 본문 Schedule 2 ("EU Standard Contractual Clauses") 에 **EU Commission Implementing Decision 2021/914 Module 2 (controller → processor)** 가 포함되어 있어 별도 SCC 체결 불필요. UK addendum 도 동일 schedule 에 포함.

## EU-US DPF (Data Privacy Framework)

OpenAI 는 EU-US DPF 인증 보유 (Active 상태) — https://www.dataprivacyframework.gov/ 에서 "OpenAI" 검색 시 verify 가능. SCC 와 함께 이중 보호.

## Zero Data Retention 상태 (PR-SEC10 적용 후)

| 엔드포인트 | per-call ZDR | 코드 적용 |
|---|---|---|
| `/v1/chat/completions` · Responses · AI SDK chat | ✓ `store: false` | `src/lib/llm/config.ts` ZERO_RETENTION 상수 — 모든 AI SDK chat 호출에 자동 적용 |
| `/v1/embeddings` | ✗ (per-call 없음) | org 차원 ZDR 신청 필요 |
| `/v1/audio/transcriptions` (Whisper / gpt-4o-mini-transcribe) | ✗ | org 차원 ZDR 신청 필요 |
| `/v1/realtime/sessions` (translate / voice-concierge) | ✗ | org 차원 ZDR 신청 필요 |

org 차원 **Zero Data Retention 신청 = enterprise plan 또는 별도 신청** (https://openai.com/policies/business-terms — "ZDR opt-in") — chris.lee 의 dashboard owner 액션.

## Incident notification

DPA §7 (Personal Data Breach): OpenAI 가 침해를 **인지한 후 72시간 이내** 에 우리에게 통지. 이메일 = OpenAI organization 의 billing email (현재: chris.lee@meteor-research.com).

## Data subject rights (DSR) 위임

OpenAI 가 처리하는 데이터는 모두 우리 (controller) 의 사용자 데이터. DSR 요청은 우리가 받아서 `/api/account/delete` / `/api/account/export` 로 처리하면 OpenAI 측에는 `store: false` 덕분에 별도 삭제 요청이 거의 필요 없음. 예외 (embeddings · audio · Realtime) 는 org-level ZDR 활성 시 동일하게 무보존.

## 다음 검토 시점

- 매년 또는 OpenAI DPA URL 의 버전이 바뀔 때 (자동 알림 없음 — 분기별 manual check)
