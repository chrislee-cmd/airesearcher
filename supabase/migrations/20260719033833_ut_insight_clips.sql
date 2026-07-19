-- AI UT 인사이트 클립 (card 626, 방식 A) — 트웰브랩스 풀영상 1회 인덱싱 →
-- Marengo/전사-LLM 순간 탐색 → ffmpeg 클립(ut-clips 버킷) → Pegasus 클립 분석 →
-- LLM 세션 인사이트 리포트. 모두 additive: 기존 ut_sessions 상태 walk(613/623)·
-- 622 비전 계량 레이어는 건드리지 않는다. 파이프라인 상태는 별도 `insight_status`
-- 컬럼으로 추적(기존 `status` 와 독립)하므로 status CHECK 제약을 바꾸지 않는다.
--
-- ⚠ 프라이버시: 영상분석기가 이미 쓰는 외부 전송 패턴이나 UT 녹화 민감도↑ —
-- 클립도 private 버킷(self / super-admin) 으로만 노출, 인사이트/인용은 코드에서
-- 카드번호·OTP·이메일 마스킹 후 persist.

-- ── ut_sessions: 626 파이프라인 컬럼 (additive) ────────────────────────────
alter table public.ut_sessions
  -- 전사 워드/turn 타임스탬프 persist — 613 은 plain text 만 저장해 클립 경계·
  -- 구간 발화를 못 얻었다(626 갭). Scribe turns [{start_ms,end_ms,speaker,text}].
  add column if not exists transcript_words jsonb,
  -- 트웰브랩스 풀영상 1회 인덱싱 핸들(api/video/start 패턴과 동형).
  add column if not exists tl_asset_id text,
  add column if not exists tl_indexed_asset_id text,
  add column if not exists tl_index_id text,
  -- 626 파이프라인 상태 머신(기존 status 와 독립):
  --   null → indexing → searching → analyzing → reporting → done | error
  add column if not exists insight_status text,
  add column if not exists insight_error text,
  -- 세션 인사이트 리포트(LLM 종합). null until reporting 완료.
  add column if not exists insight_summary jsonb;

-- ── ut_clips: 클립별 인사이트 ──────────────────────────────────────────────
create table if not exists public.ut_clips (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.ut_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  start_ms        integer not null,
  end_ms          integer not null,
  storage_key     text,                        -- path inside ut-clips (null until ffmpeg 컷 성공)
  theme           text,                        -- 순간 테마(혼란/에러/강한 반응 …)
  transcript_span text,                        -- 구간 발화(경계 스냅된 turn 텍스트)
  relevance       real,                        -- 순간 관심도(0..1)
  insight         jsonb,                       -- Pegasus/텍스트-LLM 분석(마스킹됨)
  created_at      timestamptz not null default now()
);

-- 세션의 클립을 시간 순으로 조회(갤러리) — 인덱스 하나로 정렬 스캔 충족.
create index if not exists ut_clips_session_start_idx
  on public.ut_clips (session_id, start_ms);

-- ── ut_clips RLS ───────────────────────────────────────────────────────────
-- ut_sessions 와 동형: 클라는 자기 클립만 read, 쓰기는 전부 서비스 롤(API 라우트).
alter table public.ut_clips enable row level security;

create policy "ut_clips_self_read" on public.ut_clips
  for select using (auth.uid() = user_id);

create policy "ut_clips_super_admin_read" on public.ut_clips
  for select using (
    (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );

-- ── Storage bucket (private) ───────────────────────────────────────────────
-- ut-clips: 잘라낸 순간 클립(mp4). 원본 녹화(ut-recording)와 같은 민감도라
-- private + 짧은 서명 URL 로만 노출. 100 MB cap(짧은 순간 클립).
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('ut-clips', 'ut-clips', false, 104857600)
on conflict (id) do nothing;

-- ── Storage RLS (ut-clips) ─────────────────────────────────────────────────
-- 키 규약 {user_id}/{session_id}/{clip_id}.mp4 — 선두 {user_id} 세그먼트로 per-user
-- 스코프. 업로드는 서비스 롤(서명 URL 우회)이고, 아래는 직접 접근 방어선.
create policy "ut_clips_object_self_rw" on storage.objects
  for all using (
    bucket_id = 'ut-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'ut-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "ut_clips_object_super_admin_read" on storage.objects
  for select using (
    bucket_id = 'ut-clips'
    and (auth.jwt() ->> 'email') in (
      'chris.lee@meteor-research.com',
      'lee880728@gmail.com'
    )
  );
