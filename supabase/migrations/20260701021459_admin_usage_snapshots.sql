-- admin_usage_snapshots — /admin/api-usage 의 "예상 청구액" baseline 저장소.
--
-- PR (admin-api-usage-snapshot-save-reset): provider Admin API 는 cumulative
-- USD 만 반환하므로 "진짜 0 리셋" 이 불가능하다. 대신 사용자가 provider 사이트
-- 에서 크레딧을 충전한 시점의 cumulative 값을 **baseline** 으로 저장해 두고,
-- 표시는 `현재 cumulative - baseline = 예상 다음 청구액` 으로 차감한다. "리셋"
-- 은 새 snapshot 을 baseline 으로 갱신하는 것과 동등 (표시가 다시 0 부터).
--
-- providers jsonb 모양:
--   { "anthropic": { "cumulative_usd": 50.0 }, "openai": { "cumulative_usd": 12.3 }, ... }
-- USD cost 를 노출하지 않는 provider 는 키 자체가 없다 (그 row 는 baseline 없음).
--
-- 옛 snapshot 은 audit 용으로 보존 (사용자 명시 "삭제 X"). 조회는 항상
-- taken_at desc 의 최신 1건 = 현재 baseline.

create table if not exists public.admin_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null default now(),
  -- 하드코딩 super-admin gate (src/lib/admin/superadmin.ts) 를 통과한 이메일.
  -- 감사 목적 — 누가 언제 baseline 을 갱신했는지 기록.
  taken_by_email text not null,
  providers jsonb not null,
  -- 향후 baseline 종류 분화 여지 (현재는 'next_invoice' 단일).
  baseline_for text not null default 'next_invoice',
  note text
);

create index if not exists admin_usage_snapshots_taken_at_idx
  on public.admin_usage_snapshots (taken_at desc);

-- RLS 를 켜되 정책을 두지 않는다 = anon / authenticated 는 전부 거부, 오직
-- service_role 만 접근. super-admin gate 는 DB row/JWT 가 아니라 코드
-- (isSuperAdminEmail) 에서만 판정한다는 superadmin.ts 의 설계 철학과 일치 —
-- 모든 접근은 super-admin gate 를 통과한 API route 의 service-role client 로만
-- 이뤄진다. 실수로 프로필 row 편집 등으로 접근 권한이 새는 경로를 원천 차단.
alter table public.admin_usage_snapshots enable row level security;
