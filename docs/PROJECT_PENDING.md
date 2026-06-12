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
- 2026-06-12 · PR #272 (Lemon Squeezy 결제 연동) · §7 (함정) · **LS Test/Live 모드는 서로 다른 store + variant ID namespace 를 가진다** — Live 모드에서 만든 product 의 variant ID 는 Test API key 로 호출 시 404 ("related resource does not exist") 로 거부됨. preview 검증을 하려면 (a) Test 모드 토글 후 같은 상품 재생성 → Test variant ID 별도 발급, (b) preview env 의 `LEMONSQUEEZY_VARIANT_*` / `LEMONSQUEEZY_STORE_ID` 도 Test 값으로 분기 등록. Live 가격 변경 시 Test 도 같이 갱신해야 preview 검증이 prod 와 동등해짐. §7 에 함정 한 줄 + 운영 체크리스트.
- 2026-06-12 · PR #272 (Lemon Squeezy 결제 연동) · §7 (함정) + 외부 도구 (`jarvis/sync-to-vercel.sh`) · **mode-specific 키 (LS API key 처럼 dev/preview/production 마다 다른 값을 가져야 하는 류) 는 `sync-to-vercel.sh` 로 동기화 불가** — 스크립트가 `ai-researcher.env` 만 SSOT 로 읽고 `.preview.env` / `.production.env` 는 무시. preview 에 Test 키 등록할 때 `.preview.env` 만 갱신해도 sync 가 안 일어남 → Vercel 에 직접 `vercel env add KEY preview <branch> --value <v> --yes` 우회 필요. 또한 Vercel CLI 최근 업데이트로 preview 등록 시 git branch 인자 필수 — 기존 sync 스크립트의 stdin-pipe 방식도 깨짐. §7 한 줄 + sync 스크립트 mode-aware 패치는 별도 chore PR.

