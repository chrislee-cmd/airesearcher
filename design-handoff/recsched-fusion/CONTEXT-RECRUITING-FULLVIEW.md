# CONTEXT 2/3 — recruiting 위젯 전체보기(fullview) 추출 (디자인 + 백엔드)

> **용도**: 융합 리디자인 CD 인풋 2/3. origin/main 2026-07-24 기준(writer 검수). 짝: `CONTEXT-RECSCHED.md` + `FUSION-BRIEF.md`.

---

# A. 디자인 표면

## A1. 공유 풀뷰 셸 (6위젯 공통)
- **프레임**(fullview-shell): 캔버스 위 대형 모달 **90vw×90vh, max 1600×900**(Modal size=wide bare). 3px ink 보더 + fv-frame-shadow. 좌 240px 사이드바 + 우(헤더+본문). backdrop/Esc/포커스트랩=Modal.
- **사이드바**: "위젯 네비" + 6위젯 세로(파스텔 dot+라벨; 활성=ink 2px 박스+섀도; LIVE 빨강 pulse/DONE 민트/locked dim). 클릭·숫자키 1–9로 풀뷰 유지한 채 위젯 전환.
- **헤더**: 하단 2px ink + 위젯 파스텔 톤(**리크루팅=sun**). 좌=Outfit 800 22px 타이틀+프로젝트 pill 슬롯, 우=상태 chip+액션+✕(32px, memphis-sm). 조각: `FullviewProjectPill`(**인터랙티브 드롭다운 모드 최근 추가 — 리크루팅은 아직 display-only**), `FullviewStatusChip`, `FullviewDoneBadge`, `FullviewEndSessionButton`.
- **⚠️ 발견 — 리크루팅 헤더 액션 데드 포털**: body 가 프로젝트 pill·`↓ CSV`·`↻ 새로고침`을 `renderInHeaderStart/End` 로 포털하는데 **셸이 그 DOM 을 끝내 주입 안 함** → main 기준 리크루팅 풀뷰엔 이 세 개가 **렌더되지 않음**. probing/desk/interpreter 는 `FullviewHeaderSlotProvider` publish 로 이관 완료, 리크루팅만 미이관. **리디자인에서 반드시 해결.**

## A2. 리크루팅 풀뷰 본문 (CD state 08 "Responses")
레이아웃 = **좌 400px 고정(2px ink 분리) + 우 flex-1**.
- **(조건부) 경고 배너**: 저장된 참여자 조건 없으면 warning Banner + "재발행"(풀뷰 닫고 카드 위저드 복귀).
- **좌상 — 참여자 조건 패널**: 카드(2px ink·radius 12·memphis-faint) · 🎯 "참여자 조건"+개수 · 요약 1-2문장 + criteria chip(mono 카테고리+볼드 라벨; 필수=amore 보더+빨강 "필수"; detail=tooltip). Empty 안내.
- **좌하 — 분포 패널**: 📊 "분포"+총 n + "질문 필터" 팝오버 트리거 · **성별×연령 크로스탭**(mono, Σ 합계, grand total=amore-deep, 0="·") · **셀=크로스필터 토글**(다중, active=amore/12+볼드) · **수치는 필터 무관 원본 고정**(각주 명시) · 활성 시 **필터 chip 줄**(셀 chip·질문 chip·✕·모두 지우기). 상태 5종(로딩/폼无/응답로딩/문항无/응답0).
- **질문 필터 메뉴**: "질문 필터 ▼"(+배지) → portal 팝오버, 객관식 아코디언→답변 체크박스. 질문 내 OR·질문 간 AND, 셀 필터와 별개 축.
- **우 상단 바**: 폼 셀렉터("제목 (발행일)", min 240px; 폼0=rec 톤 chip "발행 설문 없음") + **"요약"/"전체 데이터"** 탭 pill.
- **요약 탭 — 부합도 판단 테이블**: fit 필터 칩(전체/높음/중간/낮음+카운트, "업데이트 중…") · 컬럼 = 응답자(#N+⚠flags)/성별/연령/지역/부합도·근거(fit 배지 High=그린·Medium=amore·Low=회색, 근거 2줄 clamp) · fit 랭크 안정 정렬 · footer 카운트 · 상태 5종(미선택/에러+재시도/판단중 skeleton 6행/판단0/무매치) · **행 클릭→응답자 드로어**.
- **응답자 드로어**(레거시 재사용): 우 420px slide-in, ←/→ 내비 · 헤더 #N+fit+인구통계 chip+근거 전문+flags · 본문 전 문항 Q→A · **PII 문항=🔒 "값이 가려져 있습니다" 점선 박스**(unlock 无 — 크레딧 해제 폐기).
- **전체 데이터 탭 — 응답 스프레드시트**(레거시 822줄 — **데이터 SSOT 라 항상 마운트**, 요약 탭일 땐 hidden): 체크박스 열(전체선택 indeterminate)+응답시각+응답 컬럼(3줄 clamp) · **PII 컬럼은 DOM 자체에서 제외** · 크로스필터 적용+200행 cap+footer 카운트/외부 링크(↗ Sheets/폼) · **📧 초대 보내기(n명)** 벌크 CTA→확인 모달("크레딧 无, 관리자 대행")→POST→토스트 · 상태 9종(로딩/에러/폼0/응답로딩/**재인증 배너**/**미연동**/**운영자 토큰 만료**/응답0/무매치).

## A3. 위젯 카드 (축약)
604×900 캔버스 카드(sun 밴드, 💎10). 4-스텝 셋업 아코디언: ①소스 자료(붙여넣기+파일→Extract) ②참여자 조건(LLM 스트림→chip 리뷰→Approve) ③심사 설문(LLM 생성→섹션 리뷰, 표준 블록 🔒)④Google 발행(양승인 자동; OAuth 왕복 시 draft localStorage 복귀 재개). CTA `Publish form →`. 발행 후 `WidgetStatusFooter`("완료"+**"전체 보기"**). admin-proxy 모드=운영자 Drive 발행, 유저 OAuth 생략.

## A4. 풀뷰/관련 진입 경로 전수
| # | 진입 | 비고 |
|---|---|---|
| 1 | 카드 헤더 "전체 보기" 버튼 | 전 위젯 공통 |
| 2 | 발행 완료 푸터 "전체 보기" | |
| 3 | 풀뷰 사이드바 위젯 전환 / 숫자키 | |
| 4 | 리스트 뷰 모드(chrome 'page') | 레거시 경로 |
| 5 | `/recruiting` → `/canvas?focus=recruiting` redirect | 카드 확장만 |
| 6 | **어드민 `/admin/recruiting-invitations`** — 슈퍼어드민 초대요청 처리대(pending/sent/declined/archived, **unmask 연락처 조회**) | 별도 서피스 |
| 7 | **어드민 `/admin/recruiting-scheduling`** — 스케줄링 스택 | **융합에서 제거 대상 진입** |

---

# B. 백엔드 계약

## B1. 데이터 모델
**응답 저장 无 — Google Forms 가 응답 SSOT.** 매 조회 라이브 fetch. 파생 캐시=judgments 만.

| 테이블 | 핵심 | 비고 |
|---|---|---|
| `recruiting_forms` | form_id(Google id, PK)·user_id·org_id·title·responder/edit_uri·sheet_url/id·**owner_email**(admin-proxy 라우팅 키)·**criteria jsonb**+summary·**status**(draft/published/extracting/extracted/error) | RLS self; insert=service-role |
| `recruiting_invitations` | id·org_id·requester_user_id·**project_id(uuid nullable, FK 无)**·form_id·**response_ids text[]**·status(pending/sent/declined/archived)·admin_note·processed_at | 크레딧 PII unlock 대체품. RLS self+슈퍼어드민 |
| `recruiting_response_judgments` | (form_id,response_key) unique·judgment jsonb{gender,age_group,region,fit,fit_reason,flags}·criteria_hash | LLM 판단 캐시. **PII 에코 차단 스키마**. 쓰기=service-role |
| ~~recruiting_pii_unlocks~~ | 20260704 **drop** | 크레딧 해제 폐기 물증 |

**PII 정책**(`lib/recruiting-pii.ts`): 이름·전화 2카테고리, 정규화 후 **정확 일치** 화이트리스트. **서버가 값 블랭킹**(`maskPiiAnswers`) — 원본 PII 는 브라우저로 절대 안 흐름. 스프레드시트=컬럼째 숨김, 드로어=🔒, CSV=제외. **unmask 유일 경로 = 슈퍼어드민 contacts 라우트.**

## B2. API 표면
| Route | M | Auth | 요점 |
|---|---|---|---|
| `/api/recruiting/google/forms/list` | GET | 로그인 | 폼 목록(criteria 포함, 마이그 폴백 3단) |
| `…/forms/[id]/responses` | GET | 로그인+소유 | Forms 라이브 fetch → 동의 gate → **PII 서버 블랭킹** → {columns,rows,piiQuestionIds,…}. 403/412/401(+reauth_url)/503/502 |
| `…/forms/[id]/judgments` | GET(300s) | 동일 | **증분 LLM 판단**(신규·criteria_hash stale 만, ~20명/콜) → upsert → {judgments,…} |
| `/api/recruiting/invitations` | POST | 로그인+org | {form_id, project_id?, response_ids(1..500)} → pending 1행. **무료, 실발송=어드민 대행** |
| 〃 | GET/PATCH | 슈퍼어드민 | 처리대 목록/상태 변경 |
| `…/invitations/[id]/contacts` | GET | 슈퍼어드민 | **유일 unmask** — 전 컬럼·연락처 강조 |
| `…/forms/create` | POST | 로그인 | Forms+Sheet 생성, 표준블록, criteria persist(criteriaPersisted 플래그) |
| `…/google/status·start·callback·disconnect` | | 로그인 | OAuth. **admin-proxy 면 status 항상 connected** |
| `…/extract`·`/survey` | POST 스트림 | 로그인 | 위저드 LLM |

**Google 토큰 라우팅**(`form-access.ts`): 소유 검증 + owner_email=admin → proxy 토큰 / else per-user refresh. responses/judgments/contacts 전부 동일 경로.

## B3. 핵심 플로우
- **응답 lift/refresh**: Spreadsheet(항상 마운트)가 fetch → 콜백으로 **host(recruiting-card)에 전부 lift** → 분포·조건·요약에 분배. 통합 새로고침 = spreadsheet refetch + judgeRefreshSignal++ + 필터 리셋.
- **Judge**: 요약 탭 mount/폼 전환/signal → 증분 판단(criteria_hash 무효화) → fit+demographics+flags; response_key 로 원본 join → 드로어.
- **크로스필터 SSOT**: host `activeFilter{cells[],questions[]}` → 분포 하이라이트(수치 고정)+spreadsheet 행 필터. 셀 간 OR·질문 내 OR·질문 간 AND.
- **CSV**: 전체 responseData(필터 무관)→PII 제외+BOM+CRLF. *현재 데드 포털로 버튼 미노출.*
- **🔑 초대 플로우 & scheduling 연결 (융합 핵심)**: ①유저: raw 탭 체크→POST invitations(response_ids만) ②슈퍼어드민: 처리대→contacts unmask→**앱 밖 수작업 발송**→sent. ③**scheduling 과 코드·스키마 완전 분리 — invitations→sched_candidates FK/API/자동 경로 0.** sched 후보 소스 = 파일 업로드 or 시트 import(리크루팅 응답 시트 URL 을 수동으로 붙여넣는 게 사실상 유일한 다리). **자동화 0 — 융합이 메울 갭이 정확히 이 지점.**

## B4. 호스트/프레젠테이션 경계 (props 계약)
- **recruiting-card ExpandedBody = 컨테이너 SSOT**: activeFilter·filterableQuestions·responseData·loading들·forms·activeFormId·selectedForm·activeTab·judgeRefreshSignal·conditionsBrief·isPublished. 조건 우선순위 = 저장 criteria > 위저드 실시간 brief.
- **RecruitingFullviewBody = 순수 프레젠테이션**: props {projectName, conditionsForPanel, criteriaPersistMissing, onCriteriaRepublish, responseData, responsesLoading, formsLoading, hasForm, filterableQuestions, activeFilter, onFilterChange, forms, activeFormId, onSelectFormId, activeTab, onTabChange, judgeRefreshSignal, hasResponses, onDownloadCsv, onRefresh, rawTabContent}. 예외적 내부 fetch = judged-table 의 judgments GET. raw 탭 = host 가 만든 `<ResponsesSpreadsheet controlled/>` children 주입(항상 마운트 = 데이터 파이프). 카드 unmount 无 → 풀뷰 열어도 위저드 state 유지.
- **레거시 잔재**: respondent-drawer + responses-spreadsheet 은 레거시가 V2 안에서 재사용 중 — **유일한 비-CD 프레젠테이션**. (conditions/distribution-panel·judged-list-table 은 supersede 완료.)

## 리디자인-관련 발견 요약
1. **헤더 액션 데드 포털**(pill·CSV·새로고침 미렌더) — HeaderSlot publish 이관 필수. 2. 프로젝트 pill 인터랙티브 모드 존재하나 리크루팅 미배선. 3. **invitations→scheduling 자동 연결 부재 = 최대 수동 갭.** 4. 분포 축 자동감지(성별/연령) — override lib 존재·UI 미노출. 5. forms.status FSM 은 퍼널용으로만, 풀뷰 미표면.
