-- 합류 확인(joined) 기록 — 문자 알림 자격의 SSOT.
--
-- 배경(사용자 결정 2026-07-26): 전체/그룹 공지·문자 알림이 신청자 전체(450명)로
-- 잡히던 오류를 차단한다. 문자 알림은 "링크를 받아 합류(상호 동의)가 확인된
-- 사람"에게만 나가야 한다 — 게이트는 status='confirmed' 가 아니라 아래 joined_at.
-- (status 는 관리자가 임의로 바꾸는 coarse 플래그일 뿐 합류 여부와 다르다.)
--
--   joined_at    — 참가자가 공개 링크 폰게이트를 최초 통과(= 합류 확인)한 시각.
--                  최초 1회만 세팅(불변). 문자 알림 자격의 필요조건.
--   last_seen_at — 마지막 접속 시각(운영 관찰용, 매 접속 갱신·스로틀).
--
-- Additive(nullable) 라 머지 자동 적용 게이트를 그대로 통과한다.
alter table public.sched_candidates
  add column if not exists joined_at timestamptz;
alter table public.sched_candidates
  add column if not exists last_seen_at timestamptz;

-- 백필(1회, 명시적 가정): 기존 status='confirmed' 행은 조율(링크 왕복)을 거쳐
-- 확정된 사람들이므로 이미 합류한 것으로 본다 → joined_at := created_at.
-- 이 백필이 없으면 배포 직후 확정자에게도 문자가 0건 나가 운영이 끊긴다.
-- pending/communicating 은 합류 여부가 불명이라 채우지 않는다 — 재접속(폰게이트
-- 통과) 시 자연 기록된다. idempotent: joined_at 이 비어 있는 확정자만 채운다.
update public.sched_candidates
  set joined_at = created_at
  where status = 'confirmed' and joined_at is null;

-- 문자 대상 산출은 batch 단위로 "합류자만" 훑는다 → (batch_id, joined_at) 인덱스.
create index if not exists sched_candidates_batch_joined_idx
  on public.sched_candidates (batch_id, joined_at);
