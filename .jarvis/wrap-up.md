## 2026-10-08T14:05 · feat/chain-ui-integration · session c0497626

### Changed
- `src/components/canvas/chain/` — v1 프레젠테이션 제거(ChainBar·chain-bar-host·ChainEntryBlock) 후 v2 커넥터 오버레이 8종 신설: chain-geometry(경로 계산·세로 거터 선택) · chain-edge-layer(SVG) · chain-port(out/in/dim/handle/target) · chain-capsule(4톤+S2b 피커) · chain-report-node · chain-summary-pill(+host) · chain-entry-popover · chain-overlay(측정·배치 호스트)
- `src/components/canvas/chain/chain-chip.tsx` — 한 위젯이 두 단계를 맡을 때 범위 표기("체인 3–4/4")
- `src/components/canvas/chain/widget-chain-provider.tsx` — 유지. 헤더 주석을 v2 구성으로 갱신(writer 지시)
- `src/lib/chains/view.ts` — deriveEdgeKinds · capsuleEdgeIndex · runningEdgeIndex · lastEdgeTargetsReport 추가
- `src/app/[locale]/(app)/canvas/canvas-board.tsx` — 오버레이 마운트(변환 레이어 안) · 요약 pill(변환 밖) · 거터 top padding · S3b 비체인 dim
- `src/components/canvas/widgets/probing-card.tsx` — **origin/main 으로 완전 원복**(diff 0). 진입이 출력 포트로 이동
- `src/app/globals.css` — .chain-node-ring 제거 → .chain-edge-flow(흐름 dash + reduced-motion)
- `messages/{ko,en,ja,th}.json` — Chain 네임스페이스 v2 재작성(바 전용 키 제거, 캡슐·포트·팝오버·산출물 키 추가)

### State
PR #1329 가 v2(커넥터 오버레이)로 교체 완료. CI·Vercel green, 프리뷰 conformance 완료 — 오라클이 결함 2건(줌아웃에서 캡슐·팝오버·포트 클릭 불가, 같은 원인의 팝오버 가림)을 잡아 수정 반영. 사용자 프리뷰 확인 → writer update-branch → 머지 대기.

### Open
- **CD 되물림 후보**: 도착 카드가 아래 행이면 캡슐(아래쪽 고정·위로 자람)이 위 행 카드와 겹친다 — CD 는 같은 행만 그려 미규정. 현재는 CD 불변식 유지 + 떠 있게 둠(불투명·z 위). 뒤집기 규칙이 필요하면 CD 판단
- e2e 실세션(approve/skip/resume)은 실 크레딧이 나가 미집행 — 사용자 프리뷰 단계. cancel 경로는 과금 0 이라 실제 왕복 확인 완료
- `tests/check-design.test.ts` 2건은 브랜치 이전부터 실패(CI hard gate 아님) — 별 티켓 후보

### Next
- 사용자 프리뷰 확인: 프로빙 카드 hover → `+` 핸들 → 팝오버 → 연결하기 → 거터 엣지·요약 pill·칩
- writer 가 update-branch 후 머지 → jarvis sync.sh 가 spec done 전환
- 후속 검토: 캡슐 겹침 규칙(위 Open) · 전사록/인터뷰 분석 진입점(E 변형, CD 미도해)

## 2026-10-07T16:43 · feat/chain-ui-integration · session c0497626

### Changed
- `src/lib/chains/view.ts` — 신설. 서버 row → 프레젠테이션 `ChainView` 매핑. 종결 체인(cancelled/done/error)의 비종결 단계를 접어 "유령 상태 금지"를 데이터층에서 보장
- `src/components/canvas/chain/chain-bar.tsx` — 신설. 캔버스 상단 체인 바 B1~B9 전 상태 + 트랙 노드 7종 + B3 프로젝트 피커
- `src/components/canvas/chain/chain-chip.tsx` — 신설. 카드 서브바 우측 칩 6상태
- `src/components/canvas/chain/chain-entry-block.tsx` — 신설. 프로빙 셋업 하단 진입점 E1(off 기본)/E2/E3
- `src/components/canvas/chain/widget-chain-provider.tsx` — 신설. 컨테이너(조회 + widget_chains realtime + approve/skip/cancel/resume + 생성 + 칩 파생)
- `src/components/canvas/chain/chain-bar-host.tsx` — 신설. 캔버스 마운트 + 피커 데이터 + 기존 생성 모달 재사용
- `src/components/canvas/shell/widget-shell.tsx` — `subbarEnd?: ReactNode` 슬롯 1개 추가(미전달 시 서브바 미렌더 → 비체인 카드 diff 0)
- `src/components/canvas/widgets/probing-card.tsx` — 진입점 블록 배선 + 세션 시작 시 체인 생성 + footNote 접미. ControlBoardPanel `fill` 제거(겹침 수정)
- `src/app/[locale]/(app)/canvas/{page,canvas-board}.tsx` — Provider 래핑 + 바 마운트 + 칩 전달
- `src/app/api/chains/route.ts` — GET `project_id` 선택화(프로빙 진입 체인은 project_id null)
- `src/app/api/chains/[id]/approve/route.ts` — optional `project_id` 본문(B3 귀속)
- `src/app/api/chains/[id]/resume/route.ts` — 신설. paused → running CAS + 재kick (B5 재개 출구가 없었음)
- `src/app/globals.css` — `.chain-node-ring` 키프레임(+reduced-motion) · `--shadow-memphis-sm-mid` 토큰 승격
- `messages/{ko,en,ja,th}.json` — `Chain` 네임스페이스 4로케일

### State
PR #1329 오픈, CI·Vercel 전부 green, 프리뷰 conformance(규칙 2d) 완료 — 픽셀 diff 오라클이 CD 이탈 3건(canvas cascade 가 제목·토글·세그먼트 침범, 진입점 블록이 아코디언 위로 겹침)을 잡아 전부 수정 반영. writer 에 "conformance 완료" 보고했고 머지 대기 중.

### Open
- e2e 실세션(프로빙 → 전사 → 승인 → 인제스트 → 탑라인)은 미실행 — 실제 크레딧이 나가서 워커 판단으로 사용자/writer 지시 대기. 상태 전이·액션 배선은 DB 직접 전이로 전수 확인됨
- 런치 프롬프트의 "Playwright 로 시각 검증 안 함" ↔ 스펙 규칙 2d(픽셀 diff 필수) 충돌 — writer 에 문구 정리 제기함
- `tests/check-design.test.ts` 2건은 이 브랜치 이전부터 실패(clean tree 재현). CI hard gate 아님 — 별 티켓 후보
- 미리보기 행 line-height 가 CD 대비 행당 ~1.5px 높음(색·구조 영향 0) — 잔여 미세 괴리

### Next
- writer 머지 후 `sync.sh` 가 spec status 를 done 으로 전환
- 사용자 프리뷰 확인: 체인 토글 ON → 짧은 세션 → B2 승인 행 → B3 피커 경로
- 후속 검토: E 변형 진입점(전사록·인터뷰 분석에서 체인 시작, CD 미도해) · `steps[].file_count` 어댑터 기록(현재 미구현이라 fileCount 분해 표시 미작동)
