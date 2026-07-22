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
- [ ] **셸 (공유 계약)** — 프레임·헤더밴드·**통합 툴바 pill**·레일·스텝노드·푸터 CTA 가 `design-handoff/WIDGET-SHELL.md` 준수. feature 별 즉흥 재구성 0. *(결함 C: 툴바 3박스 분리 방지)*
- [ ] **조립** — 개별 요소 클래스뿐 아니라 **조립(composition)**도 일치 (툴바=단일 pill·세그 순서 등 §S2/§1b). 요소 맞아도 조립 틀리면 fail.
- [ ] **토큰/클래스** — 모든 시각요소가 BUILD-SPEC §1 class map 과 일치 (raw hex/px 0, `check:design` 통과)
- [ ] **지오메트리** — 폭/높이/여백이 GEOMETRY/.dc.html 실측과 일치 (임의 이탈 0)
- [ ] **상태 = pre-data + post-data 둘 다** — §3 정적 스냅샷 전부 구현. **데이터 의존 스텝의 빈 상태를 placeholder 바로 때우지 말 것** — pre-data = **고스트 프리뷰**(실 컴포넌트 muted + "추출 후 자동생성" 라벨), post-data = canonical(실데이터). error/timeout/empty/disabled 등 배너도 전부. *(결함 A: 텅 빈 스텝 방지)*
- [ ] **문자열 = i18n 키만** — 모든 문구를 i18n 키로 렌더(하드코딩 0). BUILD-SPEC 의 EN 은 **참조용**, canonical = 제품 로케일. `check:i18n` ko/en/ja/th 패리티. *(결함 B: EN/KO 뒤섞임 방지)*
- [ ] **proposed-token** — 기존 토큰에 매핑했거나 토큰-PR 로 승격
- [ ] **⚠️ contract-change** — §5 항목 전부 writer 와 해결 (임의 발명 0)
