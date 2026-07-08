-- 20260708151416_transcript_mode_speaker_count.sql
--
-- Adds `mode` + `speaker_count` to `transcript_jobs` for the transcript
-- generator's new control surface (card #484):
--   · mode          — 'research' (리서치 인터뷰 전사, 현행) | 'meeting' (회의록 전사).
--                     회의록 요약+Todo 결과물(#485)이 이 값으로 gating. 이 PR 은
--                     값 저장만 하고 전사 자체는 두 모드 동일(현행 회귀 0).
--   · speaker_count — 사용자가 고른 발화자 수 hint. 1 / 2 / 3(="3명 이상").
--                     NULL = 미지정(=현행 auto diarize). start route 가 1·2 일 때만
--                     ElevenLabs num_speakers 로 실어 보낸다(3+/NULL = auto).
--
-- Both nullable-safe with defaults so pre-migration rows and in-flight inserts
-- keep working: mode defaults to 'research' (현행 동작), speaker_count stays NULL.

alter table public.transcript_jobs
  add column if not exists mode text not null default 'research',
  add column if not exists speaker_count smallint;

-- Guard rails — mode is a closed set, speaker_count is a small positive hint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transcript_jobs_mode_check'
  ) then
    alter table public.transcript_jobs
      add constraint transcript_jobs_mode_check
      check (mode in ('research', 'meeting'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'transcript_jobs_speaker_count_check'
  ) then
    alter table public.transcript_jobs
      add constraint transcript_jobs_speaker_count_check
      check (speaker_count is null or speaker_count between 1 and 3);
  end if;
end $$;
