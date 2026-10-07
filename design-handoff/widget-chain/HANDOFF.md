# HANDOFF — 위젯 체인 UI (CD → worker)

> 인풋: `CONTEXT-FOR-CD.md`(widget-chain). 참조는 파일명 + § 만 씁니다.

## 0. 폴더
| 파일 | 역할 |
|---|---|
| `HANDOFF.md` | 이 문서 — 먼저 |
| `BUILD-SPEC.md` | §0 결정 · §1 클래스맵 · §3 상태 매트릭스 · **§5 계약 질의(빌드 전)** |
| `widget-chain.dc.html` | 비주얼 SSOT — C0 캔버스 맥락 · C1 진입점 3 · C2 바 9상태 · C3 칩 6 · C4 노드 6 |
| `support.js` | 컴프 단독 실행용 런타임. 포팅 대상 아님 |

## 1. 읽는 순서
1. `BUILD-SPEC.md §0` — 왜 바인지. 건너뛰면 나머지가 납득되지 않습니다.
2. `widget-chain.dc.html` C0 → C2 순서로.
3. `BUILD-SPEC.md §5` — 5건을 writer 와 먼저 닫으세요. 1·2·3 은 삭제해도 레이아웃이 성립하게 그렸습니다.

## 2. 만들 것 (새 컴포넌트 3)
- `<ChainBar view onApprove onSkip onCancel onResume onTopUp onOpen onDismiss />` — 캔버스 레벨, 위젯 밖.
- `<ChainChip step total status />` — `WidgetShell` 서브바 우측 슬롯에 주입. **셸 수정 금지**, 슬롯이 없으면 슬롯만 추가.
- `<ChainEntryBlock mode onToggle onModeChange preview />` — 프로빙 셋업 본문 하단.

데이터 페칭·realtime 구독은 컨테이너. 이 세 컴포넌트는 `ChainView` 와 콜백만 받습니다.

## 3. 지어내지 말 것
- 확인 모달(체인 종료) · 카운트다운(자동) · 바 접기 버튼 · Navigator 표시 — 전부 **의도적으로 없음**.
- 상태가 빠졌다고 판단되면 CD 로 되돌리세요.

## 4. done-when
- [ ] B1–B9 전부 도달 가능 · E1–E3 토글 동작
- [ ] B5·B6·B9 에 processing 색/링/펄스 0 (유령 상태 금지)
- [ ] 진행 버튼에 다음 단계 비용이 붙고, cost 0 이면 금액 없이 "진행 →"
- [ ] B3 에서 프로젝트 선택 전 진행 잠김 · 건너뛰기 숨김
- [ ] 비체인 카드에 칩 없음 · 셸 헤더/툴바 diff 0
- [ ] 바가 캔버스 가로 스크롤을 따라옴(sticky) · Picker 패널(z-60)이 바 위로 뜸
- [ ] reduced-motion 에서 펄스 제거
- [ ] `rounded-\[` · `shadow-\[` · raw hex grep 0

## 5. 검수
컴프 단독 렌더 ↔ Playwright 스크린샷 오버레이 diff 가 1차, BUILD-SPEC §1 대조가 2차.
