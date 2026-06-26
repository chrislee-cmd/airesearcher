# Legal — DPA / SCC 보관

GDPR Art. 28 (processor), Art. 44–49 (international transfer) 응답을 위해 외부 processor 와 체결한 **Data Processing Agreement** 와 **EU Standard Contractual Clauses (SCC 2021/914)** 의 실행본을 이 디렉토리에 보관합니다.

`docs/security-audit-data-flow.md` §4 처리자 매핑이 이 디렉토리의 파일을 참조합니다.

## 보관 규칙

- 파일명 패턴: `dpa-<provider>.<ext>` (실행 PDF) + 옆에 `dpa-<provider>.md` 메타데이터.
- PDF 은 LFS 없이 commit (보통 50–300KB · git native 로 충분).
- 실행 후 변경된 경우 새 파일 `dpa-<provider>-<YYYY-MM-DD>.<ext>` 로 추가하고 기존 파일은 보관 (감사용).
- 만료 / 갱신 시점은 메타데이터 `.md` 의 `next_review` 필드.

## 현재 상태

| Processor | DPA 메타데이터 | DPA 실행본 | SCC 포함 | 다음 리뷰 |
|---|---|---|---|---|
| OpenAI (API) | `dpa-openai.md` | TODO — legal 팀이 PDF 추가 | ✓ DPA Schedule 2 (Module 2: controller → processor) | 갱신 시 또는 1년 |
| Anthropic (Claude) | `dpa-anthropic.md` | TODO — legal 팀이 PDF 추가 | ✓ DPA Schedule 3 (Module 2 + 추가 보호조치) | 갱신 시 또는 1년 |

> **워커 → legal 팀 핸드오프**: PR-SEC10 워커가 메타데이터 `.md` 와 ZDR 코드 설정까지 완료. 실제 서명된 PDF 의 다운로드 + commit 은 chris.lee 또는 legal 책임자가 수행 (GDPR Art. 28(9) — "DPA 는 서면 / 전자 형식, 양 당사자 서명 / clickwrap 수락 기록 보관").

## 권리 매핑

| GDPR 의무 | 관련 파일 |
|---|---|
| Art. 28(3) 처리자와의 서면 계약 | `dpa-*.md` + 첨부 PDF |
| Art. 30(2) processor 가 유지할 처리 활동 기록 (ROPA) | 각 processor 가 별도 보유 (DPA 에서 access right 명시 확인) |
| Art. 44–49 EU→US 전송 적합성 | SCC (DPA Schedule) + EU-US DPF 인증 — `docs/security-audit-data-flow.md` §4.1 |
| Art. 33–34 침해 통지 | DPA 본문 의 incident notification SLA — 각 메타데이터 `.md` 에 추출 |
