-- 공유 뷰어 OTP — 앱 자체 코드 발급/검증 저장소 (Supabase Auth 이메일 의존 제거).
--
-- 배경: 공유 뷰어 OTP 는 그동안 Supabase Auth 내장 이메일(signInWithOtp, anon)로
-- 코드를 보냈는데, 내장 서비스가 시간당 ~3–4통 하드캡 + 전용 SMTP 미설정으로
-- 전달에 실패해 수신자가 코드를 못 받는 P0 회귀가 반복됐다(2026-07-09, 2026-08-07).
-- org 초대 메일은 이미 앱 자체 transactional 경로(Gmail SMTP nodemailer)로 안정적
-- 발송된다 — 공유 OTP 만 불안정한 Auth 이메일에 묶여 있던 채널 분리가 버그의 뿌리.
--
-- 해결: 앱이 6자리 코드를 직접 발급해 이 테이블에 해시+만료로 저장하고, org 초대와
-- 같은 앱 transactional 이메일로 보낸 뒤, verify 라우트가 이 테이블 대조로 검증한다.
--
-- 접근: service_role(createAdminClient)만 읽고 쓴다 — 뷰어 라우트가 이메일 게이트를
-- 통과시킨 뒤에만 다룬다. 그래서 anon/authenticated 용 정책은 두지 않는다(RLS deny-all).
-- 코드는 평문 저장 X — HMAC 해시만(PII/시크릿 보호). Realtime 불요.

create table if not exists public.share_view_otps (
  id uuid primary key default gen_random_uuid(),
  -- 어느 공유 링크에 대한 코드인가. 링크가 사라지면 코드도 함께 정리.
  shared_view_id uuid not null references public.shared_views(id) on delete cascade,
  -- 정규화된(소문자·trim) 뷰어 이메일. 발급/검증 조회 키.
  email text not null,
  -- 평문 미저장 — HMAC(service_role, shared_view_id.email.code) base64url.
  code_hash text not null,
  -- 만료 시각(발급 시 now()+10분). 지나면 검증 거부.
  expires_at timestamptz not null,
  -- 오코드 시도 횟수 — 상한 도달 시 brute-force 차단.
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

-- 발급/검증 조회 — (링크, 이메일) 로 활성 코드 1건을 찾는다.
create index if not exists share_view_otps_lookup_idx
  on public.share_view_otps (shared_view_id, email);

-- 만료 코드 청소(운영 배치)용 보조 인덱스.
create index if not exists share_view_otps_expires_idx
  on public.share_view_otps (expires_at);

-- service_role 만 접근 — 뷰어 라우트가 게이트를 통과시킨 뒤 다룬다.
-- anon/authenticated 정책 없음 → RLS 가 사실상 deny-all(서버 라우트만 우회).
alter table public.share_view_otps enable row level security;
