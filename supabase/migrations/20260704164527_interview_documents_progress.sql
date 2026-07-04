-- Interview V2 — per-document indexing progress.
--
-- The corpus indexer (/api/interviews/index) chunks each uploaded file and
-- embeds the chunks in batches. Until now the only progress signal was the
-- parent interview_jobs.index_status flag (pending / indexing / done / error),
-- so the UI could show "인덱싱 중…" but never *how far along* a file was — a
-- multi-minute embedding pass looked frozen (user report, 2026-07-04).
--
-- These two columns let the indexer publish a chunk-level denominator +
-- numerator per document, so the file card can render a progress bar and
-- "N / M chunks (X%)". Both are nullable / default 0:
--   * total_chunks     — null for documents indexed before this migration
--                        (no backfill; the card just shows "완료"), set to
--                        chunks.length the moment a fresh index pass starts.
--   * processed_chunks — advances after each embed+insert batch, ending == total.
alter table public.interview_documents
  add column if not exists total_chunks integer,
  add column if not exists processed_chunks integer not null default 0;
