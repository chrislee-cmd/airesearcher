import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { hashString } from '@/lib/cache';
import { chunkMarkdown } from '@/lib/interview-chunking';
import { embedInterviewChunks } from '@/lib/interview-embed';
import {
  insertInterviewChunks,
  rowsPerInsertFor,
} from '@/lib/interview-index-insert';
import { logError } from '@/lib/observability/log-error';

// PR-1 — background corpus indexing for interview jobs.
//
// Triggered by interview-job-provider after /api/interviews/jobs POST
// returns successfully. Failure is non-fatal — the user's topline
// report is already on-screen; we just flip interview_jobs.index_status
// to 'error' so a future re-trigger or UI badge can pick it up.
//
// Embedding + insert can take longer than the default Vercel timeout
// for a multi-file batch, so we bump maxDuration to the platform max.
export const maxDuration = 300;

// Chunk insert resilience lives in @/lib/interview-index-insert (shared with the
// manual re-index path, run-now). Prod incidents 2026-07-13 + 2026-08-18:
// `chunk_insert_failed`, root cause = Postgres statement timeout (57014) on the
// chunk insert (1536-d pgvector + HNSW). The 2026-08-18 case was a 1.43MB /
// 1031-chunk file failing at 570/1031 every time (63 respondents dropped). Four
// axes together fix it:
//   1) adaptive batch size (rowsPerInsertFor) → smaller inserts on large files.
//   2) raised statement_timeout via the insert_interview_chunks RPC.
//   3) retry with exponential backoff (insertInterviewChunks).
//   4) resume (here) → a partially-inserted file re-runs from the already-inserted
//      prefix, so a large file completes in one or two re-runs instead of never.
// The happy path is unchanged (same embed/dedup/progress logic).

const DocumentBody = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().optional().nullable(),
  markdown: z.string().min(1),
  // Client may supply a precomputed hash; we always recompute to keep
  // dedupe authoritative on the server. Kept in the schema so the
  // client-side `Document` type can carry it without a separate shape.
  content_hash: z.string().optional(),
  project_id: z.string().uuid().optional().nullable(),
});

const Body = z.object({
  interview_job_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  documents: z.array(DocumentBody).min(1).max(50),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const limited = await checkLlmRateLimit(user.id, org.org_id);
  if (limited) return limited;

  const raw: unknown = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    // Distinguish the batch-size ceiling from generic validation failures so
    // the client can react (re-split) and logs show the real cause. The client
    // already chunks under this limit (INDEX_CHUNK_SIZE); this is a defensive
    // signal — the batch stays a 400, just a self-describing one.
    const docs =
      raw && typeof raw === 'object' && 'documents' in raw
        ? (raw as { documents?: unknown }).documents
        : undefined;
    if (Array.isArray(docs) && docs.length > 50) {
      return NextResponse.json(
        { error: 'too_many_documents', max: 50, got: docs.length },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { interview_job_id, project_id, documents } = parsed.data;

  // Verify the interview job belongs to this org before touching anything.
  // RLS would also block, but a clean 404 is a friendlier signal than the
  // "0 rows affected" you'd otherwise see when the update silently no-ops.
  const { data: jobRow, error: jobErr } = await supabase
    .from('interview_jobs')
    .select('id, org_id, project_id, index_status')
    .eq('id', interview_job_id)
    .single();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  // Admin client for the heavy writes — we want the indexing pass to
  // succeed even if RLS evolves later (chunk insert volume × per-row
  // policy eval is not worth it for a server-internal write).
  const admin = createAdminClient();

  // Mark the job 'indexing' up front so the UI chip flips immediately.
  // We intentionally don't block on the result — the chip is best-effort.
  await admin
    .from('interview_jobs')
    .update({ index_status: 'indexing' })
    .eq('id', interview_job_id)
    .eq('org_id', org.org_id);

  try {
    let totalDocs = 0;
    let totalChunks = 0;
    let skippedDocs = 0;
    // 파일 단위 실패 격리 — 한 파일의 인덱싱 실패(청크 insert 재시도 소진 · 문서
    // insert · 임베딩 실패)가 배치 전체 job 을 죽이지 않게, 실패 파일명+사유를
    // 모아 두고 루프 밖에서 job status 를 한 번만 산정한다. (이전엔 첫 파일의
    // throw 가 done 마킹 전에 바깥 catch 로 빠져 이미 100% 인덱싱된 나머지 파일까지
    // index_status='error' 로 묻었다 — 인시던트 2026-08-18 root cause.)
    const failed: { filename: string; reason: string }[] = [];

    for (const doc of documents) {
      try {
        const contentHash = hashString(doc.markdown);
        // The project this document lands in. content_hash is the hash of the
        // normalized markdown, so an identical file always hashes the same — a
        // true content match even across batches, jobs, or renamed files.
        const resolvedProjectId =
          project_id ?? jobRow.project_id ?? doc.project_id ?? null;

        const row = {
          org_id: org.org_id,
          project_id: resolvedProjectId,
          interview_job_id,
          filename: doc.filename,
          mime: doc.mime ?? null,
          markdown: doc.markdown,
          content_hash: contentHash,
          char_count: doc.markdown.length,
        };

        let documentId: string;
        // Whether this document row already existed (a re-run of a file that
        // partially indexed, or a true duplicate). Existing rows are candidates
        // for resume — we don't skip them outright anymore (incident 2026-08-18:
        // a large file that timed out mid-insert would re-run, find its own
        // document row, and skip → the missing chunks were never filled in).
        let isExisting = false;

        if (resolvedProjectId) {
          // Project-scoped dedupe. An atomic, race-safe insert-or-skip via
          // interview_documents_project_hash_uq (project_id, content_hash):
          // ON CONFLICT DO NOTHING. An empty result means an identical document
          // already lives in this project — either a fully-indexed duplicate or
          // a file that timed out mid-insert on an earlier run. We resolve the
          // existing row's id and decide skip-vs-resume below from its actual
          // chunk count (no duplicate document row either way).
          const { data: insertedRows, error: insErr } = await admin
            .from('interview_documents')
            .upsert(row, {
              onConflict: 'project_id,content_hash',
              ignoreDuplicates: true,
            })
            .select('id');
          if (insErr) {
            console.error('[interviews/index] document upsert failed', insErr);
            throw new Error('document_insert_failed');
          }
          if (!insertedRows || insertedRows.length === 0) {
            const { data: existing } = await admin
              .from('interview_documents')
              .select('id')
              .eq('project_id', resolvedProjectId)
              .eq('content_hash', contentHash)
              .maybeSingle();
            if (!existing) {
              // Conflict reported but the row can't be read back — treat as a
              // skip rather than risk a duplicate insert.
              skippedDocs += 1;
              continue;
            }
            documentId = existing.id;
            isExisting = true;
          } else {
            documentId = insertedRows[0].id;
            totalDocs += 1;
          }
        } else {
          // Legacy project-less path — job-scoped dedupe
          // (interview_documents_job_hash_uq). Same file re-uploaded in the same
          // job reuses the existing row (and resumes its chunks); multiple
          // NULL-project rows are allowed by the project index (NULLs distinct),
          // so job scope is the only guard here.
          const { data: existing } = await admin
            .from('interview_documents')
            .select('id')
            .eq('interview_job_id', interview_job_id)
            .eq('content_hash', contentHash)
            .maybeSingle();
          if (existing) {
            documentId = existing.id;
            isExisting = true;
          } else {
            const { data: inserted, error: insErr } = await admin
              .from('interview_documents')
              .insert(row)
              .select('id')
              .single();
            if (insErr || !inserted) {
              console.error('[interviews/index] document insert failed', insErr);
              throw new Error('document_insert_failed');
            }
            documentId = inserted.id;
            totalDocs += 1;
          }
        }

        const chunks = chunkMarkdown(doc.markdown, {
          filename: doc.filename,
          docId: documentId,
        });
        if (chunks.length === 0) continue;

        // Resume point. chunkMarkdown is deterministic (same markdown → same
        // chunk list in the same order), and each batch insert is all-or-nothing
        // (a timed-out statement is cancelled whole → zero rows), so the chunks
        // already in the table are exactly the leading prefix chunks[0..N-1].
        // Count them to know where to pick up. count(*) is authoritative here —
        // processed_chunks is a best-effort progress tick that may lag a crash.
        let resumeFrom = 0;
        if (isExisting) {
          const { count } = await admin
            .from('interview_chunks')
            .select('id', { count: 'exact', head: true })
            .eq('document_id', documentId);
          resumeFrom = count ?? 0;
          if (resumeFrom >= chunks.length) {
            // Fully indexed already — a true duplicate, nothing to resume.
            skippedDocs += 1;
            continue;
          }
        }

        // Publish the denominator (and the resume offset) before the first
        // (slow) embed call so the file card flips from a bare "인덱싱 중…" to
        // "N / M chunks" the moment the client's 2s poll picks it up.
        await admin
          .from('interview_documents')
          .update({ total_chunks: chunks.length, processed_chunks: resumeFrom })
          .eq('id', documentId);

        // Adaptive batch size for this file — larger files get smaller inserts
        // so per-statement HNSW work stays under the (raised) statement_timeout.
        const rowsPerInsert = rowsPerInsertFor(chunks.length);

        // Embed + insert in adaptive batches, starting from the resume offset.
        // Embedding per-batch (rather than all-at-once up front) is what lets
        // processed_chunks advance mid-file so the progress bar actually moves;
        // already-embedded chunks hit the content-addressed cache on re-run, so
        // a resume is cheap.
        let processed = resumeFrom;
        for (let i = resumeFrom; i < chunks.length; i += rowsPerInsert) {
          const slice = chunks.slice(i, i + rowsPerInsert);
          const embedded = await embedInterviewChunks(slice);
          const rows = embedded.map((c) => ({
            org_id: org.org_id,
            interview_job_id,
            document_id: documentId,
            content: c.content,
            metadata: c.metadata,
            // pgvector accepts the literal string and casts implicitly.
            embedding: c.embedding_literal,
          }));
          // Insert via the RPC (raised statement_timeout) with retry/backoff.
          // Throws `chunk_insert_failed: …` on give-up, carrying the real PG
          // code/message; the partially-inserted chunks stay (deterministic
          // prefix) so a re-run resumes this file exactly where it stopped.
          await insertInterviewChunks(admin, rows);
          processed += embedded.length;
          // Progress tick — best-effort; the client polls interview_documents.
          await admin
            .from('interview_documents')
            .update({ processed_chunks: processed })
            .eq('id', documentId);
        }
        // Count only the chunks inserted this run (resumeFrom were already in
        // the table from an earlier partial run).
        totalChunks += processed - resumeFrom;
      } catch (docErr) {
        // 이 파일만 실패로 기록하고 다음 파일로 — throw 하지 않는다. 부분 삽입된
        // 청크는 그대로 두어(dedup/idempotent — 위 주석) retry 재실행이 이어받게
        // 하고, 실패 사유만 모은다.
        const reason = docErr instanceof Error ? docErr.message : 'index_failed';
        console.error('[interviews/index] document failed', {
          filename: doc.filename,
          reason,
        });
        failed.push({ filename: doc.filename, reason });
        continue;
      }
    }

    // 루프 밖에서 job status 를 failed[] 기준으로 한 번만 산정.
    if (failed.length === documents.length) {
      // 전부 실패 — 근거 0. error 로 마킹 + 중앙 관측 적재.
      const detail = failed.map((f) => `${f.filename}: ${f.reason}`).join('; ');
      await admin
        .from('interview_jobs')
        .update({ index_status: 'error', error_message: detail.slice(0, 500) })
        .eq('id', interview_job_id)
        .eq('org_id', org.org_id);
      await logError({
        feature: 'interview',
        code: 'index_failed',
        message: detail,
        context: { interview_job_id, org_id: org.org_id },
      });
      return NextResponse.json(
        { error: 'index_failed', failed_count: failed.length },
        { status: 500 },
      );
    }

    if (failed.length > 0) {
      // 부분 성공 — 완료 파일은 즉시 사용 가능해야 하므로 job 은 'done' 으로 두고,
      // 상세 실패만 error_message 에 기록한다("부분 성공은 done, 상세는
      // error_message"). 완료 파일별 게이트는 프론트가 processed>=total 로 판정한다.
      const detail = `partial: ${failed.length}/${documents.length} failed — ${failed
        .map((f) => `${f.filename}: ${f.reason}`)
        .join('; ')}`;
      console.error('[interviews/index] partial batch', {
        jobId: interview_job_id,
        failed,
      });
      await admin
        .from('interview_jobs')
        .update({ index_status: 'done', error_message: detail.slice(0, 500) })
        .eq('id', interview_job_id)
        .eq('org_id', org.org_id);
    } else {
      // 전부 성공 — 이전 실패 흔적(error_message)이 남아 있으면 함께 지운다.
      await admin
        .from('interview_jobs')
        .update({ index_status: 'done', error_message: null })
        .eq('id', interview_job_id)
        .eq('org_id', org.org_id);
    }

    // 인덱싱은 문서·청크 적재까지만 — 탑라인 생성은 여기서 자동으로 kick 하지
    // 않는다(카드 #474). 업로드/인덱싱 후 탑라인 status 는 idle 로 남아, 사용자가
    // 명시적으로 "탑라인 생성" CTA(POST /api/interviews/v2/topline)를 누를 때까지
    // Opus 를 안 돌린다(원치 않는 자동 과금 + 강제 생성뷰 진입 제거). 수동 생성·
    // 재생성 경로는 그대로 동작한다.
    return NextResponse.json({
      ok: true,
      document_count: totalDocs,
      chunk_count: totalChunks,
      skipped_count: skippedDocs,
      failed_count: failed.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'index_failed';
    console.error('[interviews/index] failed', msg);
    // Best-effort failure marker — never let the bookkeeping shadow the
    // original error.
    try {
      await admin
        .from('interview_jobs')
        // OBS-4: also stamp error_message so the admin dashboard can group
        // interview failures by cause (previously index_status='error' was
        // recorded with no reason).
        .update({ index_status: 'error', error_message: msg.slice(0, 500) })
        .eq('id', interview_job_id)
        .eq('org_id', org.org_id);
    } catch {
      // ignore
    }
    // 중앙 관측: 기존 index_status/error_message 기록과 병행 적재(회귀 0).
    await logError({
      feature: 'interview',
      code: 'index_failed',
      message: msg,
      context: { interview_job_id, org_id: org.org_id },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
