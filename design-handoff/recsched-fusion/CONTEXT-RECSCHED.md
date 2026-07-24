# CONTEXT 1/3 — recruiting-scheduling 서브시스템 전체 추출 (디자인 + 백엔드)

> **용도**: recsched×recruiting-fullview 융합 리디자인의 CD 인풋. origin/main 2026-07-24 기준 전수 추출(writer 검수). 짝: `CONTEXT-RECRUITING-FULLVIEW.md`(위젯 풀뷰 추출) + `FUSION-BRIEF.md`(융합 방향·요청사항).
> **한줄 요약**: 어드민이 프로젝트를 만들고 → 스프레드시트(파일/구글시트)로 후보를 붓고 → 그룹으로 조직하고 → 캘린더에서 슬롯을 제안/확정하고 → 공지/채팅으로 소통. 프로젝트당 **공용 링크 1개**, 참여자는 전화 뒷 6자리로 신원 증명 후 본인 일정+1:1 채팅만 봄.

---

# A. 디자인 표면

## A.0 비주얼 시스템 + 출처
- **시스템**: Memphis (2026-07-22 리디자인, CD 번들 `design-handoff/recruiting-scheduling/` — visual SSOT `Recruiting Scheduling Redesign.dc.html`). ink 2–3px 보더, 하드 오프셋 섀도, pill 세그먼트(active=ink fill), mono 대문자 eyebrow, Outfit 800 타이틀, 파스텔 아이덴티티 톤. **리크루팅 톤 = sun `#ffe8a8`**, **참여자 톤 = sky `#cfe6ff`**.
- **CD 가 그린 7프레임**: 01 어드민 리스트(전체) · 01B 그룹별 · 02 캘린더+채팅 · 02B reach 서브피커 · 03 슬롯 에디터 · 03B 참여자 폰게이트 · 04 참여자 뷰.
- **CD 미작화(워커 자작, 이번에 커버 권장)**: 리스트 empty/loading · 캘린더 empty · 채팅 empty · 폰게이트 에러 · 슬롯 에디터 **생성 모드(그룹 fan-out)** · Sheets OAuth 바운스.
- **CD 이후 사용자-승인 이탈(라이브 동작 — 리디자인에 반드시 승계)**:
  - 확정 로스터 접기 토글 · 캘린더 카드 1.5×(1020px) · **컴팩트 채팅 위계**(kind 세그먼트+reach 라디오 한 줄, 타겟 Select 인라인 reveal) · "Slots in scope" 기본접힘+count 배지
  - 캘린더 **가로 접기 레일** · **멀티창 채팅(최대 4 타일)**
  - 확정 로스터 = **읽기전용 그룹뷰 테이블** + 행별 채팅 CTA · **공지 편집/삭제**+"수정됨" · **unread 빨간콩**
  - 개인 reach = **프로젝트 전체 확정자** · 상태 **소통중** 추가 · 리스트 필터 = **상태별**(그룹별 아님)
  - 마스터링크 바 · Sheets import 카드(+"연동됨 카드" 스펙 진행중) · 협업자 공유 모달 · 그룹 fan-out 피커 · slots dedup
- **BUILD-SPEC §6 미해결 오픈 아이템**: 폰 뒷자리 충돌 UX 폴리시 · **마스터링크 rotate UI 부재**(엔드포인트만 존재) · 그룹 헤드 틴트 체계 · 캘린더 밀도 80px/h 확정.

## A.1 어드민 공통 셸
- 대형 Memphis 카드(3px ink·radius 14·8px 하드섀도, max 1360). **sun 헤더 밴드**: 🧲 · Outfit 800 23px · **List/Calendar 세그먼트** · **프로젝트 피커**(`?project=` 풀페이지 내비) · "+ New project" · **협업자 공유** 버튼(org owner/admin만).
- 인라인 새 프로젝트 생성 카드 · 프로젝트 미선택 안내 · **토스트 레이어**(성공=info, 실패=warn — 단 메시지 삭제 confirm 은 아직 `window.confirm`, 비일관).

## A.2 어드민 리스트 뷰 (01/01B)
1. **소스 인테이크 2-up** (업로드는 항상 숨은 **inbox 풀**로): CSV/XLSX 드롭존(대시 3px, 10MB; idle/uploading/각종 실패 토스트/성공 카운트) + **Google Sheets 카드**(📗, URL input+Import; importing/실패 토스트/**OAuth 바운스** — 미연결 시 안내 토스트 후 구글 동의로 풀페이지 리다이렉트).
2. **마스터링크 바**(sky bg): 🔗 · 헬퍼 · mono `/schedule/<token>` 읽기전용 필드 · Copy→토스트. share_token 없으면 숨김. (후보별 링크 컬럼은 **삭제됨**.)
3. **리스트 컨트롤**: All/By-group 세그먼트 · **상태 필터**(전체/대기/확정/소통중 — 유일한 좁히기 축) · 전체선택 · 필드 필터(동적 업로드 컬럼 key→value 2단) · 정렬(이름/연락처/이메일/다음슬롯+동적컬럼, asc/desc) · **"슬롯 추가"** primary 우측.
4. **벌크 바**(선택 시, amber): "N명 선택" · **개인 확정** · **소통중** · **그룹으로 보내기**(신규 제목 Input or 기존 Select 인라인 reveal) · 해제. 409 duplicate 토스트.
5. **후보 테이블**(지오메트리 계약): sticky-left 체크 44/이름 168/연락처 184(+2px ink 우보더), 이하 가로 스크롤. 컬럼 = ✓·이름(볼드+**상태 칩**: 확정=그린, 소통중=amore)·연락처(mono, 이메일 폴백)·이메일·**업로드 원본 전 컬럼**(240px ellipsis)·**다음 슬롯**(상태 dot+시간 링크→편집 / 대시 고스트 "슬롯 배정"→생성). empty 1행.
6. **그룹별 뷰(01B)**: 그룹당 파스텔 헤드 카드(sky→mint→lav→peach→cyan 순환, 📁, 인라인 Rename, count pill) + **미할당/inbox 섹션**(중립, 📥). 각 섹션 = 동일 테이블(무프레임).

## A.3 어드민 캘린더 뷰 (02/02B/03)
레이아웃: (그룹 필터 시) 인라인 그룹 제목 필드 → **two-pane Memphis 카드 1020px**:
1. **캘린더 페인**(fresh 빌드, 라이브러리 无): 툴바(그룹 Select "전체"+그룹들 · Outfit 주범위 · ‹/Today/› 칩 · Week/Day 세그먼트) · 요일 헤더(오늘=amore) · 그리드 08–21시 80px/h, 46px mono 거터, **빈 셀 클릭=30분 스냅 생성 모달** · **컬러 타임블록**(제안=핑크/확정=그린/취소=회색 취소선, radius 9, 2px 보더, 컬러 하드섀도, dot+Outfit 11 라벨(제목→후보명→무제)+mono 시각) · 레전드 3+힌트.
2. **가로 접기 레일**(36px 핸들, 접으면 세로 mono 라벨).
3. **채팅 페인 — 최대 4 타일**(타일 360px, 가로 스크롤, 캘린더 표시 중 max 768px): broadcast 타일 기본 오픈 · 중복 오픈=포커스 · **5번째 차단+힌트** · 타일별 독립 닫기/재타겟.

**채팅 패널 해부**: 헤더(lav 밴드, 아바타 📢/이니셜, 제목, ✕) · **컴팩트 컴포즈 위계**(📢 공지글|💬 채팅 세그먼트 + 전체/그룹/개인 라디오 한 줄; 서브피커: 전체=수신자 힌트/그룹=Select/개인=**프로젝트 전체 확정자** Select) · **Slots in scope**(기본접힘, count pill, dot·mono 시간·라벨·edit 링크, **dedup**) · 메시지(공지=sun 헤드+📢 mono 태그+warning 바디+amber 섀도 배너 / 버블=어드민 우측 amore·참여자 좌측 paper, radius 13+테일, "수정됨" 마커, **✎/🗑 hover 칩**→인라인 편집기/confirm 삭제) · 컴포저(2행, Enter 발송, 4000자, ➤ 44px ink 스퀘어) · **unread 빨간콩**(amore dot+2px ink 링; localStorage last-seen 기준, 열면 해제).

**확정 로스터 카드**(카드 아래): 접기 헤더("확정 N명"+chevron) + broadcast CTA(+빨간콩). 바디 = **읽기전용 그룹뷰**(파스텔 헤드, 체크박스 无, 다음슬롯=정적 텍스트, **행별 채팅 CTA**+빨간콩→새 타일).

**슬롯 에디터 모달(03)**: sun 헤더 ✏️ · **Title 자유텍스트 최상단**(+참여자/블록 표시 헬퍼) · **Target 카드**(개인/그룹 세그먼트, 생성 시만; 그룹=Select+"N명에게 fan-out" 헬퍼 / 개인=후보 Select **"없음" 허용=standalone 이벤트**, 편집 시 잠금) · **Time**(datetime-local ×2 + ⚠️ 소프트 overlap 경고) · **Details**(상태/장소/메모) · 푸터 Delete(편집만)/Cancel/Save.

**협업자 공유 모달**: full-member 고지 · 이메일 초대 폼(밸리데이션·토스트 5종) · 협업자 리스트(OWNER/PENDING 태그, Remove) — **역할 피커 없음**(viewer 미도입 의도).

## A.4 참여자 표면 (/schedule/[token], 03B/04)
- **셸**: 로케일/auth 밖 독립 라우트, 로그인 无, noindex, iOS safe-area/viewport-fit, 방문자별 로케일 협상.
- **진입 상태**: 죽은 링크=일반화된 풀스크린 안내(존재 비노출) / 게이트 쿠키 없음=폰게이트 / 유효 쿠키(30분 TTL)=일정 뷰.
- **폰게이트(03B)**: 중앙 Memphis 카드(380px) · 🔒 sky 칩 · "본인 확인" · **6 OTP 셀**(46×56 mono 22; empty/active amore/filled ink/error warning) + 숨은 단일 input(one-time-code) · 풀폭 확인 pill · 프라이버시 🛈 · 에러(불일치/rate-limit/일반). **충돌 플로우**: 동일 뒷자리+이름 구분 → 이름 선택 스텝 / 이름도 동일 → 전체 전화번호 스텝.
- **일정 뷰(04)**: sky 헤더 밴드(📅·이름 pill) · mono eyebrow 섹션 — **일정**(3px ink 카드+상태톤 하드섀도, 52px 날짜칩, 제목→요일 헤딩, 시간·장소·메모, 상태 pill; 취소 슬롯은 서버가 withheld) · **공지**(어드민과 동일 배너, "연구팀·시각") · **메시지**(내=우측 sky/팀=좌측 paper 버블) · **컴포저**(1행, **16px 폰트=iOS 줌 방지**, ➤ 46px) · **7초 폴링**(익명 realtime 无).

---

# B. 백엔드 계약

## B.1 데이터 모델 (sched_* 마이그레이션 전수)
계층: **sched_projects → sched_batches(=그룹) → sched_candidates**; slots/messages 는 candidate·batch 에 매달림.

| 테이블 | 핵심 컬럼 | 불변식/비고 |
|---|---|---|
| **sched_projects** | id·owner_user_id(FK auth CASCADE)·title·created_at·**share_token**(DEFAULT uuid, UNIQUE) | 마스터링크 `/schedule/<token>` = 프로젝트 식별(개인 아님) |
| **sched_batches** | id·owner_user_id·title·created_at·project_id(NULL FK)·**is_inbox** bool | is_inbox=true = 업로드 풀; 그룹은 벌크 배정으로 생성. title=캘린더 헤딩 겸용 |
| **sched_candidates** | id·batch_id FK·email/name/phone(전부 NULL 허용)·**fields jsonb**(원본 미매핑 컬럼)·participant_token(**레거시**, 존치)·**status** CHECK(pending/confirmed/communicating)·created_at | (batch_id,email) partial unique. 완전 익명 행 허용. 후보 status ≠ 슬롯 status(독립 상태기계) |
| **sched_slots** | id·candidate_id NULL·batch_id NULL·title NULL·start/end_at(UTC)·status CHECK(proposed/confirmed/cancelled)·location·note·**owner_user_id** NULL | **그룹 슬롯 = fan-out**(후보별 행 복제, 공유 row 无). **standalone**(둘 다 null)=owner_user_id 가 테넌시 앵커. 더블부킹=소프트 경고만 |
| **sched_messages** | id·candidate_id NULL·scope CHECK(broadcast/private)·sender_role(admin/participant)·sender_user_id·body·created_at·**is_announcement** DEFAULT true·batch_id NULL·**updated_at** NULL | **하드 CHECK**: broadcast⇔candidate null. broadcast 4모드 = is_announcement × batch_id. updated_at=어드민 PATCH 만("수정됨"). **supabase_realtime publication 포함** |

- **RLS = 슈퍼어드민 이메일 하드코딩 단일 정책** — org 멤버는 RLS 접근 0; 실접근 전부 코드 게이트+service-role (관례적 이중방어, RLS 벽 아님).
- **preview-DB degrade 패턴**: additive 마이그가 main 머지 때만 적용 → 전 reader/writer 가 wide-select→narrow-fallback 구현.

## B.2 API 표면 (A=어드민 게이트 getSchedulingAccess: 슈퍼어드민 OR org멤버, 无=404 은닉 / P=share_token+서명 게이트쿠키)

| Route | M | Auth | 요점 |
|---|---|---|---|
| `/api/scheduling/projects` | GET/POST | A | 목록(org 스코프)/생성(owner=호출자) |
| `…/projects/[id]/inbox` | POST | A | inbox 배치 resolve-or-create |
| `…/projects/[id]/rotate-share` | POST | A | share_token 회전. **UI 없음** |
| `…/batches` · `…/batches/[id]` | POST·PATCH | A | 그룹 생성/rename |
| `…/batches/[id]/upload` | POST | A | 파일(CSV/XLSX) → alias 매핑·identity-merge upsert → `{upserted}` |
| `…/batches/[id]/import-sheet` | POST | A+본인 Google OAuth | `{sheetUrl}` → 첫 탭 read → 동일 upsert. **412 google_not_connected/reconsent** → OAuth 바운스 |
| `…/candidates/confirm`·`set-status`·`assign-batch` | POST | A | 벌크 상태/그룹이동(409 duplicate). 외부 id 는 silent drop(owner-chain) |
| `…/candidates/[id]/reissue-token` | POST | A | 레거시 토큰 회전(사장) |
| `…/slots` | POST | A | 개인(제목 OR 후보 필요)→`{slot}` / **mode:'group' fan-out**→`{slots,count}`. owner_user_id 스탬프 |
| `…/slots/[id]` | PATCH/DELETE | A | 부분 수정/하드 삭제 |
| `…/messages` | GET | A | ?candidate=1:1 / ?batch=글로벌+그룹방송+전 프라이빗 / 无param=방송만(**org멤버 `[]`** — 테넌시) |
| `…/messages` | POST | A | broadcast{is_announcement?,batch_id?} / private{candidate_id}. **org멤버 broadcast 는 batch_id 필수(400)**. 4000자 |
| `…/messages/[id]` | PATCH/DELETE | A | **broadcast-only** 수정(updated_at)/삭제. private=불변 |
| `…/public/[token]` | GET | P | `{candidate{name}, slots(본인, 취소 withheld), messages(글로벌+본인그룹+본인 private)}`. PII 비반환 |
| `…/public/[token]/verify` | POST | P₀+**rate limit**(5/분·20/시, token:ip) | 뒷6자리 매칭 → 쿠키 / 충돌(이름선택/전체번호) / 404·429 |
| `…/public/[token]/messages` | POST | P | 참여자 발신 — **scope/candidate 는 쿠키에서만 유도**(IDOR 방어) |

## B.3 핵심 플로우
1. **소스 인제스트**: 헤더 alias 매핑(다국어 exact + 전화/이메일 substring 폴백; 이름은 exact-only) → 미매핑 컬럼 `fields` 보존 → 인코딩 스니핑(UTF-8→EUC-KR/…) → 파일 내 identity merge(email>phone>name) → **멀티키 upsert**(기존 행 매칭=UPDATE fields-union / 미스=INSERT). 항상 inbox 로.
2. **마스터링크+폰게이트**: 프로젝트당 URL 1개; 뒷 6자리 timing-safe 매칭; 성공 시 **HMAC 서명 쿠키**(candidateId.exp.sig, service-role key 서명, TTL 30분, httpOnly). 매 public 라우트가 쿠키+소속 재검증. 실방어=rate limit. rotate=링크 무효화.
3. **슬롯 제안→확정**: 셀/행/모달 생성; proposed→confirmed/cancelled; overlap 소프트 경고; 그룹=fan-out 으로 모든 read 경로 균일.
4. **채팅/공지 fan-out**: UI 위계→payload 매핑(공지·발송 × 전체·그룹 + 개인). 참여자 read 스코프는 전부 서버 필터.
5. **라이브니스**: 어드민=Realtime(sched_messages) + 15s 폴백; unread=30s 폴링+**localStorage last-seen**(서버 read-state 无); 참여자=7s 폴링.
6. **협업자**: `POST /api/members/invite`(member 고정) → pending row → **첫 방문 시 claim 자가치유**(getSchedulingAccess 내).

## B.4 테넌시 (구조 부채)
- sched_* 에 **org_id 없음** — 100% 코드 스코핑: `getSchedulingAccess` → superadmin | `ownerUserIds`(같은 org 전 멤버); owner 체인 리졸버(project/batch 직접, candidate→batch, slot→batch|candidate|owner_user_id, message→batch|candidate).
- 파생 제약: org 멤버는 **글로벌 방송 발신/조회 불가**(owner 링크 无) · standalone 슬롯은 owner in-org 만 · 레거시 owner-null standalone=슈퍼어드민 전용.
- RLS 는 두 번째 벽이 아님(전부 service-role). **리디자인이 데이터 만지면 org_id 도입이 정리 기회.**

---

## 리디자인-관련 플래그 (추출 중 발견)
1. rotate-share 엔드포인트 UI 부재(§6 오픈) · 2. 레거시 participant_token+reissue 사장 코드 · 3. 삭제 confirm 이 window.confirm(토스트 방향과 비일관) · 4. unread 가 클라 로컬 한정(멀티 디바이스 유실) · 5. CD 미작화 상태들(empty/loading/에러/생성모드/OAuth 바운스) 이번에 커버 권장 · 6. "Sheets 연동됨 카드" 스펙 인플라이트(main 미반영).
