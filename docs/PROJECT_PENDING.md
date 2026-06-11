# PROJECT.md 갱신 후보 (Inbox)

PROJECT.md(SSOT)에 반영될 수도 있는 후보들의 inbox.
룰은 [PROJECT.md §5.4](../PROJECT.md).

- 마스터가 PR 머지 후 §5.4 self-check 룰에 따라 append.
- 워커도 작업 중 발견한 SSOT 후보(새 함정, 새 절차)를 직접 추가 가능.
- 5건 누적 시 마스터가 묶어서 PROJECT.md 갱신 PR 제안.
- 폐기 후보는 line 삭제 + 이유 한 줄을 commit 메시지에.

## Inbox

<!-- 형식: - YYYY-MM-DD · PR #XXX · §X.Y · 한 줄 요약 -->
- 2026-06-11 · 본 PR (lint native control 복원) · §3.8 (하네스) + §7 (함정) · ESLint flat config 에서 같은 rule key (`no-restricted-syntax`) 를 두 scope 에 정의하면 마지막 scope 이 첫 scope 을 silently 덮어씀 — selectors 합치는 게 아니라 통째 교체. 이 함정 때문에 `design-system/no-native-controls` warn 이 `design-system/no-hardcoded-tokens` error 에 가려져 native `<button>/<input>/<textarea>` 검사가 죽어있었음 (위반 108건 가시화). 회피: 서로 다른 rule 로 분리 (`react/forbid-elements` for native, `no-restricted-syntax` for tokens). 본 PR 로 native warn / token error 분리 완료. §3.8 하네스 표에 "native control check" 한 줄, §7 함정에 한 줄 추가 필요.

