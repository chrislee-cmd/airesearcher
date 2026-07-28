-- shared_views.resource_type CHECK 확장 — 산출물 통합(narrow-waist) 편입.
--
-- 배경: shared_views (20260708093037_share_views_invites) 는 이미 polymorphic
-- 공유 인프라(토큰·만료·revoke·이메일 allow-list)인데 resource_type CHECK 가
-- interview_topline / probing_persona 2종만 허용했다. 전사록·AI UT·데스크는
-- 공유 링크 자체가 없는 기능 공백 → 3타입(transcript / ut_insight /
-- desk_report)을 같은 인프라로 편입해 4기능 공유 통일의 백엔드를 완성한다.
--
-- 발급 라우트(/api/share)가 resource_type 별로 소유권(transcript/desk=org 스코프,
-- ut=owner/admin) + 완료상태(done)를 검증하고, 공개 로더(src/lib/share/loaders.ts)
-- 가 토큰 게이트 통과 후 본문을 돌려준다. resource_id 는 여전히 polymorphic —
-- transcript→transcript_jobs.id, ut_insight→ut_sessions.id,
-- desk_report→desk_jobs.id (FK 없음, org_id 로 소유권 고정).
--
-- 안전: CHECK 를 넓히기만 하므로 기존 행 무영향(추가만). 인덱스
-- (resource_type, resource_id) 그대로. destructive 아님(drop constraint 는
-- 워크플로 DESTRUCTIVE_RE 에 안 걸림 — drop table/column 만 매칭) → 머지 시
-- 자동 적용. drop-if-exists → add 라 재실행 idempotent.

alter table public.shared_views
  drop constraint if exists shared_views_resource_type_check;

alter table public.shared_views
  add constraint shared_views_resource_type_check
  check (
    resource_type in (
      'interview_topline',
      'probing_persona',
      'transcript',
      'ut_insight',
      'desk_report'
    )
  );
