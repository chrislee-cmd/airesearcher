# PROJECT.md 갱신 후보 (Inbox)

PROJECT.md(SSOT)에 반영될 수도 있는 후보들의 inbox.
룰은 [PROJECT.md §5.4](../PROJECT.md).

- 마스터가 PR 머지 후 §5.4 self-check 룰에 따라 append.
- 워커도 작업 중 발견한 SSOT 후보(새 함정, 새 절차)를 직접 추가 가능.
- 5건 누적 시 마스터가 묶어서 PROJECT.md 갱신 PR 제안.
- 폐기 후보는 line 삭제 + 이유 한 줄을 commit 메시지에.

## Inbox

<!-- 형식: - YYYY-MM-DD · PR #XXX · §X.Y · 한 줄 요약 -->
- 2026-06-10 · 본 PR (z-index 토큰) · §9 (아키텍처) · z-index 스케일을 globals.css `@utility` 로 토큰화 (`z-table-sticky/cell-sticky/resize/fab/modal/toast/overlay`). 새 fixed/overlay 레이어 추가 시 `z-[NN]` 하드코드 금지하고 이 토큰 중 하나 사용 — 향후 §9 디자인 시스템 섹션 또는 `docs/design-system.md` 에 layer table 명시 필요.

