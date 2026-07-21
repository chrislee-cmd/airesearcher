<!--
PROJECT.md §3.4 형식. 한 줄 bullet, 짧게.
- Test plan = 리뷰어가 직접 검증할 방법 (preview URL, pnpm 스크립트, 시나리오).
- Out of scope = 이 PR에서 안 하는 일을 명시 (리뷰어 기대 정렬).
- Closes #X = 머지 시 자동 close (선택).
-->

## Summary
- 

## Test plan
- [ ] 
- [ ] supabase migration 적용 (있을 시 — `sync.sh` 가 알림)

## Out of scope
- 

## Design conformance
<!-- design-handoff/<feature> 를 포팅한 PR만 체크. 순수 로직/백엔드/비-디자인 PR 이면 "N/A" 한 줄. -->
- [ ] **N/A** — 이 PR 은 design-handoff 포팅이 아님 (아래 스킵)

design-handoff 포팅이면 (`design-handoff/<feature>/HANDOFF.md` done-when 기준):
- [ ] **토큰/클래스** — 모든 시각요소가 BUILD-SPEC §1 class map 과 일치 (raw hex/px 0, `check:design` 통과)
- [ ] **지오메트리** — 폭/높이/여백이 GEOMETRY/.dc.html 실측과 일치 (임의 이탈 0)
- [ ] **상태 전부** — §3 state matrix 의 모든 상태 구현 (error/empty/disabled/loading 포함)
- [ ] **proposed-token** — 기존 토큰에 매핑했거나 토큰-PR 로 승격
- [ ] **⚠️ contract-change** — §5 항목 전부 writer 와 해결 (임의 발명 0)
- [ ] **i18n** — 신규 문자열 ko/en/ja/th 패리티
