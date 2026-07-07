-- 인터뷰 탑라인 map-reduce (B) — 전 문서 전수 포괄 + 진행률 + per-doc 추출 캐시.
--
-- 배경 (PR 카드 #430): 탑라인 생성이 지금까지 프로젝트 전체 chunk 를 한 번의
-- Opus 패스에 밀어넣되, 코퍼스가 예산(320k자)을 넘으면 capChunksToBudget 이
-- 문서별로 chunk 를 **샘플링**해서 응답자 개개인의 발언이 유실될 수 있었다.
-- 또 단일 패스는 attention 이 희석돼 뒤쪽 응답자가 구조적으로 덜 반영된다.
--
-- map-reduce 로 전환하면 각 문서(응답자)를 **전용 map 호출로 전문(全文)** 읽어
-- 주제/인용을 구조화 추출하고(유실 0), reduce(Opus)가 N개 문서의 압축 추출을
-- 모두 받아 종합한다. 이 마이그는 그 파이프라인을 뒷받침한다:
--
--   1. interview_toplines 에 진행률 컬럼 (map_total / map_done) — 문서 수만큼
--      map 이 도는 동안 "N/M 문서 분석 중" 을 realtime 으로 노출.
--   2. interview_topline_doc_extracts — 문서별 map 추출 캐시. content_hash 가
--      캐시 키라 파일이 안 바뀐 문서는 재실행 시 map LLM 을 건너뛴다(비용 절감,
--      사용자 결정 #4 "content_hash 세트 캐시").
--
-- 모두 additive(if not exists) — 기존 탑라인 row/캐시 로직과 하위 호환.

-- ── 1. 진행률 컬럼 ──────────────────────────────────────────────────────────
-- map_total : 이번 생성이 순회하는 총 문서 수 (map 시작 시 set). null = map-reduce
--             이전 방식으로 생성된 레거시 row (UI 는 진행률 숨김).
-- map_done  : 지금까지 완료(추출 or 캐시 히트)된 문서 수. map_total 에 도달하면
--             reduce 단계로 넘어간다.
alter table public.interview_toplines
  add column if not exists map_total integer,
  add column if not exists map_done integer not null default 0;

-- ── 2. per-document map 추출 캐시 ───────────────────────────────────────────
-- 문서 하나를 map 한 결과(themes/quotes JSON)를 그 문서의 content_hash 로 캐싱.
-- 같은 파일이 안 바뀌었으면(content_hash 동일) 재실행 때 이 row 를 재사용해
-- map LLM 호출을 0 으로 만든다. 파일이 바뀌면 content_hash 가 달라져 miss →
-- 새로 map. (프로젝트 전체 캐시는 interview_toplines.content_hash 가, 문서 단위
-- 캐시는 이 테이블이 담당 — force 재생성이나 일부 파일만 교체된 경우에도 안 바뀐
-- 문서는 map 을 건너뛰게 하는 2단 캐시.)
create table if not exists public.interview_topline_doc_extracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.interview_documents(id) on delete cascade,
  -- 추출 시점 문서 content_hash = 캐시 키. 문서 내용이 바뀌면 값이 달라진다.
  content_hash text not null,
  -- map 산출 { themes: [{label, statement, chunk_ids}], quotes: [{text, chunk_id}] }.
  extract jsonb not null default '{}'::jsonb,
  -- 추출에 사용한 모델(감사/디버깅).
  model text,
  created_at timestamptz not null default now()
);

-- (document_id, content_hash) 당 1건 — 캐시 조회를 이 단일 키로 upsert.
create unique index if not exists interview_topline_doc_extracts_doc_hash_uq
  on public.interview_topline_doc_extracts (document_id, content_hash);

create index if not exists interview_topline_doc_extracts_org_idx
  on public.interview_topline_doc_extracts (org_id, created_at desc);

alter table public.interview_topline_doc_extracts enable row level security;

-- 쓰기는 서버(admin client)만. org 멤버 select 는 향후 디버깅/재사용 UI 여지.
-- interview_toplines 와 동일 컨벤션(has_org_role).
drop policy if exists "itde_select_member" on public.interview_topline_doc_extracts;
create policy "itde_select_member" on public.interview_topline_doc_extracts
  for select using (public.has_org_role(org_id, 'viewer'));

drop policy if exists "itde_insert_member" on public.interview_topline_doc_extracts;
create policy "itde_insert_member" on public.interview_topline_doc_extracts
  for insert with check (public.has_org_role(org_id, 'member'));

drop policy if exists "itde_update_member" on public.interview_topline_doc_extracts;
create policy "itde_update_member" on public.interview_topline_doc_extracts
  for update using (public.has_org_role(org_id, 'member'));

drop policy if exists "itde_delete_admin" on public.interview_topline_doc_extracts;
create policy "itde_delete_admin" on public.interview_topline_doc_extracts
  for delete using (public.has_org_role(org_id, 'admin'));
