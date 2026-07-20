-- AI UT 인사이트 파이프라인 504 멈춤 수정 (card 638 §2) — clipping 세분화 재개 가드.
-- searching(계획) → clipping(한 POST 당 클립 1개 컷) 로 쪼갠 뒤, clipping 은
-- storage_key 가 null 인(=아직 안 자른) 클립만 처리해 중단/504 후 남은 지점부터
-- 재개한다. ffmpeg 컷/업로드가 영구 실패하는 클립이 있으면 storage_key 가 계속
-- null 이라 무한 루프가 될 수 있으므로, 실패한 클립을 `cut_failed` 로 마킹해 대상
-- 에서 제외한다(그 클립은 analyzing 이 구간 발화 텍스트로 폴백 — graceful).
--
-- additive 만: 기존 row 는 default false. NOT NULL + default 라 backfill 안전.
alter table public.ut_clips
  add column if not exists cut_failed boolean not null default false;
