-- Interview corpus indexing — PR-1 of the redesign.
--
-- After the topline analysis pipeline finishes (extract → analyze →
-- summarize → vertical-synth) the markdown produced by /api/interviews/convert
-- is currently held only in React state and discarded when the user navigates
-- away. PR-2 will ship a chat surface that searches across past interview
-- transcripts; for that to work the raw markdown plus a chunk-level
-- vector index has to live in the DB.
--
-- This migration installs the storage for both halves:
--   * interview_documents — one row per uploaded file, full markdown + sha
--   * interview_chunks    — heading/paragraph-level chunks + pgvector
--                           embeddings (OpenAI text-embedding-3-small, 1536d)
--
-- A new `index_status` column on interview_jobs tracks the background
-- indexing pipeline so the UI can surface "pending / indexing / done /
-- error" without joining against the chunk tables.

create extension if not exists vector;

-- interview_documents ─────────────────────────────────────────────────
create table if not exists public.interview_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  interview_job_id uuid not null references public.interview_jobs(id) on delete cascade,
  filename text not null,
  mime text,
  markdown text not null,
  -- SHA-256 of the normalized markdown. Used to dedupe re-uploads of the
  -- same source file under the same interview_job_id — the unique index
  -- below makes the index endpoint idempotent.
  content_hash text not null,
  char_count int not null,
  created_at timestamptz not null default now()
);

create index if not exists interview_documents_job_idx
  on public.interview_documents (interview_job_id);
create index if not exists interview_documents_org_idx
  on public.interview_documents (org_id, created_at desc);
create unique index if not exists interview_documents_job_hash_uq
  on public.interview_documents (interview_job_id, content_hash);

alter table public.interview_documents enable row level security;

drop policy if exists "id_select_member" on public.interview_documents;
create policy "id_select_member" on public.interview_documents
  for select using (public.has_org_role(org_id, 'viewer'));

drop policy if exists "id_insert_member" on public.interview_documents;
create policy "id_insert_member" on public.interview_documents
  for insert with check (public.has_org_role(org_id, 'member'));

drop policy if exists "id_update_admin" on public.interview_documents;
create policy "id_update_admin" on public.interview_documents
  for update using (public.has_org_role(org_id, 'admin'));

drop policy if exists "id_delete_admin" on public.interview_documents;
create policy "id_delete_admin" on public.interview_documents
  for delete using (public.has_org_role(org_id, 'admin'));

-- interview_chunks ────────────────────────────────────────────────────
create table if not exists public.interview_chunks (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  interview_job_id uuid not null references public.interview_jobs(id) on delete cascade,
  document_id uuid not null references public.interview_documents(id) on delete cascade,
  -- Chunk text exactly as it was sent to the embedding model. The chat
  -- surface (PR-2) will quote this verbatim, so keep it lossless.
  content text not null,
  -- {filename, heading_path: text[], paragraph_index, char_start,
  --  char_end, is_quote: bool, token_estimate: int}
  -- Schema-less to avoid migrations when we extend the chunk metadata
  -- (PR-2 may add speaker / timestamp fields).
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists interview_chunks_job_idx
  on public.interview_chunks (interview_job_id);
create index if not exists interview_chunks_doc_idx
  on public.interview_chunks (document_id);
-- HNSW with cosine — matches what voc-rag-chat uses and what
-- text-embedding-3-small was trained for.
create index if not exists interview_chunks_embedding_idx
  on public.interview_chunks using hnsw (embedding vector_cosine_ops);

alter table public.interview_chunks enable row level security;

drop policy if exists "ic_select_member" on public.interview_chunks;
create policy "ic_select_member" on public.interview_chunks
  for select using (public.has_org_role(org_id, 'viewer'));

drop policy if exists "ic_insert_member" on public.interview_chunks;
create policy "ic_insert_member" on public.interview_chunks
  for insert with check (public.has_org_role(org_id, 'member'));

drop policy if exists "ic_update_admin" on public.interview_chunks;
create policy "ic_update_admin" on public.interview_chunks
  for update using (public.has_org_role(org_id, 'admin'));

drop policy if exists "ic_delete_admin" on public.interview_chunks;
create policy "ic_delete_admin" on public.interview_chunks
  for delete using (public.has_org_role(org_id, 'admin'));

-- interview_jobs.index_status ─────────────────────────────────────────
-- Tracks the background indexing pipeline. 'pending' for legacy rows
-- and brand new jobs that haven't been picked up; 'indexing' while the
-- index endpoint is running; 'done' on success; 'error' on any failure
-- (non-fatal — the user still sees the topline report).
alter table public.interview_jobs
  add column if not exists index_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_jobs_index_status_check'
  ) then
    alter table public.interview_jobs
      add constraint interview_jobs_index_status_check
      check (index_status in ('pending','indexing','done','error'));
  end if;
end $$;

create index if not exists interview_jobs_index_status_idx
  on public.interview_jobs (index_status)
  where index_status in ('pending','indexing','error');
