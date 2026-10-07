# 위젯 체인 UI — CD 설계 의뢰 (writer → CD)

_2026-10-07 · writer · 사용자 결정: 체인 UI 는 CD 설계 선행 (워커 파일럿 배너 없이 바로 정식 패턴)_

## 1. 기능 한 줄

분리된 캔버스 위젯들을 **연쇄 체인**으로 잇는다: 인터뷰 어시스턴트(프로빙) 세션이 끝나면 전사록이, 전사록이 끝나면 인터뷰 분석·보고서가 **이어서** 돈다. 단계마다 크레딧이 들므로 **기본 = 단계별 승인**(다음 단계와 비용을 보여주고 사용자가 진행/건너뛰기/종료를 고름), 자동 모드는 체인 생성 시 opt-in.

## 2. CD 가 설계할 표면 (파일럿 범위)

1. **체인 생성 진입점** — 위젯(파일럿: 프로빙 셋업)에서 "이어서 자동 진행" 옵션: 모드 선택(단계별 승인 ↔ 자동) + 체인 미리보기(남은 단계 + 단계별 크레딧 + 합계). 진입 위젯에 따라 남은 단계 수가 달라짐(§4 데이터).
2. **단계 승인 모먼트** — 단계 완료 시: "전사록 완료 → 다음: 인터뷰 분석 (10 크레딧)" + [진행] [건너뛰기] [체인 종료]. **캔버스 어디에 뜨는가가 핵심 설계 질문** (완료 위젯? 다음 위젯? 전역 배너? — CD 판단).
3. **체인 진행 표시** — 체인에 묶인 위젯들이 "연결돼 있음 + 지금 몇 단계" 를 보여주는 시각 언어. Navigator 가 이미 전 위젯 상태 맵을 읽는다(§5).
4. **중단 상태 2종** — 크레딧 부족 멈춤(잔액 충전 → 재개 CTA) · 단계 실패(사유 + 체인 종료됨). **유령 상태 금지**: 멈춘 체인이 "진행 중"처럼 보이면 안 됨.
5. **프로젝트 선택 스텝** — 프로빙 세션은 프로젝트 귀속이 없어, 인터뷰 분석 단계 전에 대상 프로젝트 선택(또는 신규 생성)이 1회 필요.

## 3. 상태 계약 (prop/데이터 — writer 가 못박음, SSOT)

```ts
type ChainView = {
  id: string;
  mode: 'approve' | 'auto';
  status: 'running' | 'awaiting_approval' | 'done' | 'error' | 'cancelled' | 'paused_insufficient_credits';
  steps: Array<{
    feature: 'probing' | 'transcripts' | 'interview_ingest' | 'topline';
    status: 'pending' | 'running' | 'done' | 'skipped' | 'error' | 'awaiting';
    cost: number;          // 크레딧. topline 은 가격 책정 중 — 0 이면 "포함" 으로 표기(금액 미표시)
    error?: string | null;
  }>;
  currentStep: number;
  projectId: string | null; // null 이면 §2-5 프로젝트 선택 필요
};
// 액션: approve(stepIdx) · skip(stepIdx) · cancel() · resume() — 전부 컨테이너(워커) 소유
```

**경계**: CD = 프레젠테이션 전부(레이아웃·톤·모션·상태 비주얼, typed props, 데이터 페칭 없음). 워커 = 컨테이너(realtime 구독·액션 배선). 이 계약 밖 데이터가 필요하면 proposed-prop 으로 되물림.

## 4. 단계·비용 데이터 (표시용 사실)

| 단계 | 한글명 | 크레딧 | 비고 |
|---|---|---|---|
| probing | 인터뷰 어시스턴트 | 25 | 세션 과금(진입 단계 — 체인 시작 전 이미 차감) |
| transcripts | 전사 | 1 | 완료 시 차감 |
| interview_ingest | 인터뷰 분석 인제스트 | 25/파일 | 선차감 |
| topline | 탑라인 보고서 | 책정 중 | 실측 미터링 진행 — 확정 전 "포함" 표기 |

진입점 가변: 프로빙 진입 = 4단계 전부 / 전사록 진입 = 3단계 / 인터뷰 분석 진입 = 2단계.

## 5. 기존 비주얼 문맥 (AUTHORITY 참조)

- 셸 규약: `design-handoff/WIDGET-SHELL.md` §AUTHORITY — 위젯 프레임·토큰은 기존 셸 그대로, **체인은 "위젯 사이"의 신규 레이어**라 greenfield.
- 참조 구현: Navigator 의 위젯 상태 pill (`widget-state-context` 맵), 승인 모먼트의 유사 선례 = 리크루팅 브리지 N1 바 + N4 모달 (`design-handoff/recruiting-journey/`).
- 산출물 규칙: `design-handoff/CD-DELIVERABLE-RULES.md` (번들 README+HANDOFF+BUILD-SPEC+.dc.html, 상태 전부 — §2 의 중단 2종 포함 **최소 8 상태**).

## 6. 설계 결정이 필요한 열린 질문 (CD 몫)

- 승인 모먼트의 위치/강도 (모달 vs 인라인 vs 전역) — 자동 모드와의 시각 차등 포함
- 체인 "연결됨" 의 시각 언어 (위젯 카드 간 물리적 연결? 배지? Navigator 전용?)
- 4로케일 카피 톤 (writer 가 i18n 키 계약은 통합 스펙에서 확정)
