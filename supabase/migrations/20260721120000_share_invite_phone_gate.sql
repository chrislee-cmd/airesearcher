-- 공유 뷰어 뒷자리 진입 게이트 — shared_view_invites 에 참석자 전화 매핑 추가.
--
-- 배경(2026-07-21, PR-B 보안코어): 현행 이메일 OTP 게이트를 전화번호 뒷자리
-- 게이트로 대체한다. 링크(token)가 진짜 시크릿이고, 뒷자리는 token 스코프
-- 안에서 "어떤 참석자(invite)인가"를 고르는 약한 선택자다. 각 invite row 가
-- 곧 참석자 레코드 — 여기에 전화(전체) + 뒷자리 조회 컬럼을 얹는다.
--
-- 컬럼:
--   phone       — 참석자 전화 전체(정규화된 숫자만). 유일성/충돌 판정의 기준.
--                 기존 PII 규약(scheduler bookings.phone = 평문 text) 을 따라
--                 평문으로 저장한다. 노출은 service_role + RLS(부모 종속)로 차단.
--   phone_last4 — 게이트 입력(뒷자리 4자리)으로 attendee 를 서버에서만 도출하기
--                 위한 조회 키. phone 의 마지막 4자리.
--
-- 🔒 신원은 서버 강제: 뒷자리→attendee 매핑은 (shared_view_id, phone_last4)
-- 인덱스로 서버에서만 도출한다. 클라이언트가 보낸 attendee 식별자는 신뢰하지
-- 않는다. 한 링크에 뒷자리가 겹치는 참석자가 2명 이상이면 뒷자리만으로는
-- 모호 → 게이트가 fail-closed(일반 안내)로 처리한다(§API).
--
-- additive-only(§7.5): add column if not exists + create index if not exists.
-- 기존 이메일-only invite row 는 phone/phone_last4 가 null 로 남아 뒷자리
-- 게이트 대상에서 자연히 제외된다(회귀 없음).

alter table public.shared_view_invites
  add column if not exists phone text,
  add column if not exists phone_last4 text;

-- 게이트 조회 인덱스 — (share, 뒷자리) 로 attendee 를 좁힌다. 뒷자리는
-- 저-엔트로피라 partial 로 non-null 만 인덱싱(이메일-only invite 제외).
create index if not exists shared_view_invites_last4_idx
  on public.shared_view_invites (shared_view_id, phone_last4)
  where phone_last4 is not null;
