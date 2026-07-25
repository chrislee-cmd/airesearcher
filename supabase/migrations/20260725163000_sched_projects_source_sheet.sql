-- journey ② 명단 — linked Google Sheet card (R9 / card 557 흡수).
--
-- The 명단 tab's Google Sheets source becomes a persistent "연동됨 카드": once a
-- project imports from a sheet, we remember WHICH sheet so the card can show its
-- title + last-sync time and offer 재동기화(re-sync)/재연결(reconnect) instead of
-- an empty url field every time.
--
--   source_sheet_url        — the canonical /spreadsheets/d/<id>/edit URL last imported.
--   source_sheet_title      — the spreadsheet's title (properties.title), for display.
--   source_sheet_synced_at  — when the last successful import ran.
--
-- One linked sheet per project (sheets import lands in the project's inbox pool),
-- so the link lives on sched_projects. All three are additive + nullable so the
-- merge-to-main auto-apply gate ships them without manual review, and a preview DB
-- that lacks them degrades (the card just shows the empty url state).

alter table public.sched_projects
  add column if not exists source_sheet_url text;
alter table public.sched_projects
  add column if not exists source_sheet_title text;
alter table public.sched_projects
  add column if not exists source_sheet_synced_at timestamptz;
