-- probing_session_recordings — 프로빙(인터뷰) 세션 원본 오디오 보존 (#554).
--
-- 배경: use-realtime-transcription 은 mic(getUserMedia)/tab(getDisplayMedia)
-- 오디오를 OpenAI Realtime STT 로 직스트림한 뒤 텍스트 세그먼트만 남기고
-- 원본 오디오를 버린다 — 인터뷰 원본이 안 남았다. 이 마이그는 종료 시
-- MediaRecorder 로 병렬 녹음한 blob 을 담을 private 버킷 + 메타 row 를 만든다.
--
-- 설계(스펙 #554):
--   - MediaRecorder 는 STT WebRTC 경로와 무간섭(같은 capture 스트림에 병렬 tap).
--   - 종료(stop) 시 blob 조립 → 이 버킷 업로드 → 이 테이블 row insert.
--   - 녹음은 순수 부가물 — 업로드/insert 실패가 세션 종료·결과를 막지 않는다.
--
-- session_id 는 probing_session_runs / credit_transactions.generation_id 와
-- 같은 realtime 세션 UUID 를 재사용한다 (중복 식별자 금지 — probing_session_runs
-- 마이그 §13 정합). 다운로드는 storage self-read RLS 기반 signed URL.
--
-- Storage path convention (클라이언트 강제 + 아래 RLS folder 검사와 동일):
--   {user_id}/{session_id}/{timestamp}-{random}.webm
-- 선두 {user_id} 세그먼트가 per-user storage 정책의 매칭 대상 — 유저는 자기
-- prefix 아래에서만 read/write.

-- ── Table ──────────────────────────────────────────────────────────────
create table if not exists public.probing_session_recordings (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- realtime 세션 UUID = probing_session_runs.session_id 와 동일 값 재사용.
  session_id       uuid not null,
  -- probing-session-audio 버킷 안 경로. {user_id}/{session_id}/{ts}-{rand}.webm
  storage_key      text not null,
  mime             text not null default 'audio/webm',
  size_bytes       bigint,
  duration_seconds integer,
  created_at       timestamptz not null default now()
);

-- "이 유저 / 이 세션의 최근 녹음" 이 유일한 read pattern.
create index if not exists probing_session_recordings_user_created_idx
  on public.probing_session_recordings (user_id, created_at desc);
create index if not exists probing_session_recordings_session_idx
  on public.probing_session_recordings (session_id);

-- ── Table RLS ──────────────────────────────────────────────────────────
alter table public.probing_session_recordings enable row level security;

-- 본인 row 만 select. probing_session_runs 패턴과 동일.
drop policy if exists "probing_recordings_own_select" on public.probing_session_recordings;
create policy "probing_recordings_own_select" on public.probing_session_recordings
  for select using (user_id = auth.uid());

-- insert 는 org membership 검사를 추가해 forged payload 차단. update/delete 는
-- 열지 않는다 — 녹음 메타는 append-only (서비스 롤은 RLS 우회).
drop policy if exists "probing_recordings_own_insert" on public.probing_session_recordings;
create policy "probing_recordings_own_insert" on public.probing_session_recordings
  for insert with check (
    user_id = auth.uid() and public.has_org_role(org_id, 'member')
  );

-- 슈퍼 어드민 전체 read (qa_feedbacks 패턴과 동일한 JWT email 클레임 게이트).
drop policy if exists "probing_recordings_super_admin_read" on public.probing_session_recordings;
create policy "probing_recordings_super_admin_read" on public.probing_session_recordings
  for select using (
    (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );

-- ── Storage bucket (private, 2 GB cap) ───────────────────────────────────
-- opus 40분 ≈ 38MB 이지만 장시간 인터뷰(60~90분) + mp4 폴백 여유로 2GB.
-- db push 로 완전 provisioning; 재실행 idempotent.
insert into storage.buckets (id, name, public, file_size_limit)
values ('probing-session-audio', 'probing-session-audio', false, 2147483648)
on conflict (id) do nothing;

-- ── Storage RLS (storage.objects) ────────────────────────────────────────
-- 유저는 자기 {user_id}/ prefix 아래에만 업로드…
drop policy if exists "probing_audio_self_upload" on storage.objects;
create policy "probing_audio_self_upload" on storage.objects
  for insert with check (
    bucket_id = 'probing-session-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- …그리고 자기 파일만 read (signed URL 도 RLS 우회하지만 직접 authenticated
-- read 도 올바르게 scope). 다운로드 signed URL 생성에 이 select 정책이 필요.
drop policy if exists "probing_audio_self_read" on storage.objects;
create policy "probing_audio_self_read" on storage.objects
  for select using (
    bucket_id = 'probing-session-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 슈퍼 어드민은 버킷 전체 read (동일 JWT 클레임 게이트).
drop policy if exists "probing_audio_super_admin_read" on storage.objects;
create policy "probing_audio_super_admin_read" on storage.objects
  for select using (
    bucket_id = 'probing-session-audio'
    and (auth.jwt() ->> 'email') = 'chris.lee@meteor-research.com'
  );
