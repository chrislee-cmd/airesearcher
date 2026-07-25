# WRITER GAP-AUDIT — recruiting-journey 번들 vs 현행 제품 (2026-07-25)

> **용도**: 워커 필독 SSOT. CD 번들(.dc.html+BUILD-SPEC)을 현행 제품 추출본(`design-handoff/recsched-fusion/CONTEXT-*.md`)과 전수 대조한 결과. **과거 프레시빌드 누락 사고(desk 통째·probing inject)의 재발 방지 장치** — 아래 "🔴 미작화·미유예" 항목은 comps 에 없어도 **반드시 구현/승계**해야 한다.
> **writer 결정(2026-07-25, 아래 명시)** 포함 — D1-A·D2·D3 채택 및 충돌 5건 판정.

## 0. 확정 결정 (writer, 사용자 위임 "이거로 작업")
- **D1 = A** (어드민 게이트): 브리지 = 초대요청 v2. 유저가 ①에서 선택→보내기 = `recruiting_invitations` 생성 → **슈퍼어드민 승인(sent) 시 서버가 자동 인제스트**(sched_candidates, 연락처는 응답유래 = 유저에게 마스킹). **raw 탭의 구 "📧 초대 보내기" CTA 는 브리지로 통합·대체**(이중 CTA 금지). `/admin/recruiting-invitations` 처리대 존치(=승인 게이트).
- **D2**: 1600×940 + ③ 내부 스크롤 — **recruiting 풀뷰 한정**(공유 셸 전역 변경 아님; 셸에 per-widget 치수 옵션).
- **D3**: 마스터링크 chip + Share 헤더 승격 (전 탭).
- **D5**: 폼:프로젝트 = 1:1 lazy (form_id null 수동 프로젝트는 명단 탭 프로젝트 스위처로 접근 가능하게 — 고아 방지).
- **로스터 형태(충돌 5)**: **라이브 그룹뷰 구조 유지**(라운드3 사용자 명시 요청이 우선) + 행 표현만 CD chip 스타일 절충 가능. CD chip-wrap 평면화로 그룹 맥락 삭제 금지.
- **이메일 컬럼 + 동적 fields 컬럼**: **라이브 그대로 유지**(comp 의 연령/지역은 동적 컬럼 예시로 해석). 컬럼 drop 금지.

## 1. 신규 요소 (comps 有 → 신규 작업, §5 미명명분 굵게)
| # | 요소 | 함의 |
|---|---|---|
| 1 | 3탭 폴더 내비 + **count pill** | **per-tab counts** — 헤더 mount 시 경량 카운트(응답 n·후보 n·확정 n) 필요(신규 endpoint or 병렬 light fetch) |
| 2 | 헤더 마스터링크 chip | **provisioning 타이밍 명세 필요**: 풀뷰 오픈 시 form→project lazy resolve(없으면 생성) — "첫 브리지"보다 앞당김. chip 은 project 생기기 전 숨김 대신 **오픈 시 즉시 생성** 채택 |
| 3 | 헤더 Share 버튼 | 기존 collab-share 모달 이동, 게이트는 통일 접근모델 따름 |
| 4 | 요약 판단테이블 **선택 모드**(체크박스+선택행 bg) | 신규 — 현행은 raw 탭에만 체크박스 |
| 5 | 브리지 바 + N4 브리지 모달(타겟그룹 Select·PII 고지·masked 리스트·dedup 노트) | §5.1 브리지 API |
| 6 | ② "응답에서 연동" 소스 카드("N명 연동됨 🔒") | 브리지드 후보 카운트 집계 |
| 7 | **`sched_candidates.source` 프로비넌스 컬럼(§5 미명명 — additive 마이그 필수)**: `bridge`/`upload`/`sheet`(기존 row backfill=upload 추정 or null=plaintext 취급) | ② 소스 컬럼·소스별 마스킹·연동 카운트 전부 이 컬럼 기반 |
| 8 | 듀얼 PII 렌더(브리지=🔒 마스킹·업로드/시트=평문) + footer 레전드 | **마스킹은 서버 강제**(source 기반, 클라 마스킹 금지) |
| 9 | 프레임 1600×940 + ③ 내부 스크롤 | recruiting 한정 셸 옵션 |
| 10 | 데드포털 fix: pill(인터랙티브)·refresh·**CSV**(comps 미작화지만 §5.4 계약 — 워커 구현, 기존 버튼 스타일) | HeaderSlotProvider publish 이관 |
| 11 | 진입 제거: `/admin/recruiting-scheduling`→`/canvas?focus=recruiting` redirect + 계정메뉴 엔트리 제거 | |
| 12 | 접근 통일(폼 소유자 OR org 멤버) + **`sched_*` org_id 도입** | B4 부채 정리 동반 |
| 13 | 사이드바 하단 노트 카드 | minor |

## 2. 🔴 미작화·미유예 (comps·유예목록 어디에도 없음 → 스펙이 명시, 라이브 동작 SSOT 로 승계)
| # | 항목 | 승계 기준 |
|---|---|---|
| R1 | **② 그룹별 뷰(01B) 전체** — 파스텔 그룹 헤드·인라인 rename·count pill·미할당(inbox) 섹션 | 최고위험. 라이브(CONTEXT-RECSCHED A.2.6) 그대로 + CD 톤 |
| R2 | **슬롯 에디터 완전체** — edit 모드(타겟 잠금·Delete)·개인 타겟+"없음"(standalone)·Details(상태/장소/메모)·overlap ⚠️ 소프트 경고 | N5 는 create+그룹만 — 거기 앵커링 금지. 라이브(A.3 슬롯 에디터) 전체 승계 |
| R3 | **raw 탭 = 레거시 ResponsesSpreadsheet 존치·상시 마운트**(데이터 lift 파이프 SSOT — unmount 시 전체 파이프 붕괴). 200cap·동의 gate·PII 컬럼 제외·외부링크 포함 | CONTEXT-RECRUITING-FULLVIEW B4 |
| R4 | **criteria-missing 재발행 배너**(props 계약 존재) | A2 |
| R5 | 판단 상태들(업데이트중·skeleton 6행·에러+재시도·판단0·무매치) + raw 탭 미연동/운영자토큰만료 상태 | A2 라이브 |
| R6 | **멀티타일 채팅 시각**(comp 1타일뿐) — 4-max·중복=포커스·5번째 차단·타일폭 **380px**(comp 이 SSOT, 라이브 360 아님)·가로 스크롤 | 동작=라이브, 타일폭=comp |
| R7 | reach 서브피커(그룹 Select·개인=프로젝트 전체 확정자 Select) — 구 02B 프레임 참조 | |
| R8 | 벌크 "그룹으로 보내기" 인라인 reveal(신규제목 Input/기존 Select) | A.2.4 |
| R9 | 업로드 드롭존 상태들 + **Sheets OAuth 바운스**(유예가 "구 번들 재사용"을 가리키나 구 번들에도 미작화 — 워커 자작, 라이브 동작 승계) + **"연동됨 카드"**(카드 557 인플라이트 — 이 에픽에 흡수, ② 소스카드와 통합) | |
| R10 | 캘린더 Day 뷰 레이아웃·그룹 필터 시 인라인 그룹제목 필드·오늘 amore 하이라이트 | 라이브 |
| R11 | collab-share 모달 = 라이브 컴포넌트 재사용(프레시빌드 예외 명시) | |

## 3. 시각↔프로즈 충돌 판정 (AUTHORITY: .dc.html 우선, 예외 명시)
| 충돌 | 판정 |
|---|---|
| CSV 버튼 comps 无 vs §5.4 "필수" | **계약 우선(예외)** — 워커 구현(헤더, 기존 스타일). CD 후속 프레임 요청 항목으로 기록 |
| refresh N1 만 vs "전 탭" | **전 탭**(HANDOFF 프로즈 채택 — 탭마다 새로고침 대상 존재) |
| bridge-bar-bg 토큰 #eafaf0 vs comp #e8f7ee | comp 승 → 토큰값 #e8f7ee 로 정정 |
| 채팅 타일 360 vs comp 380 | comp 승 → 380 |
| 로스터 chip-wrap vs 라이브 그룹뷰 | **라이브 그룹뷰 구조 유지**(writer 결정 §0) — 행 표현만 chip 절충 |
| 취소 슬롯 취소선 无(comp) | comp 승 — conformance 에서 버그로 오인 금지 |

## 4. 보존 계약 (불변 — BUILD-SPEC §5.6 + CONTEXT §B 전체)
참여자 라우트/폰게이트/HMAC 쿠키 · 채팅 fan-out payload · 슬롯 fan-out · 인제스트 upsert(멀티키) · Realtime/폴링 · 응답 PII 블랭킹 파이프 · admin-proxy 토큰 라우팅 · sticky-3col 지오메트리(44/168/184).
