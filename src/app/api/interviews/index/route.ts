import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { checkLlmRateLimit } from '@/lib/rate-limit';
import { hashString } from '@/lib/cache';
import { chunkMarkdown } from '@/lib/interview-chunking';
import { embedInterviewChunks } from '@/lib/interview-embed';
import { maybeKickTopline } from '@/lib/interview-v2/topline';

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

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
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

    for (const doc of documents) {
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

      if (resolvedProjectId) {
        // Project-scoped dedupe (the fix). An atomic, race-safe insert-or-skip
        // via interview_documents_project_hash_uq (project_id, content_hash):
        // ON CONFLICT DO NOTHING. An empty result means an identical document
        // already lives in this project — possibly from an earlier upload
        // batch under a different interview_job — so skip re-chunk / re-embed
        // entirely (no duplicate row, no wasted embedding cost).
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
          skippedDocs += 1;
          continue;
        }
        documentId = insertedRows[0].id;
        totalDocs += 1;
      } else {
        // Legacy project-less path — keep the original job-scoped dedupe
        // (interview_documents_job_hash_uq). Same file re-uploaded in the same
        // job doesn't produce a duplicate row, and re-running the indexer is
        // safe. Multiple NULL-project rows are allowed by the project index
        // (NULLs are distinct), so job scope is the only guard here.
        const { data: existing } = await admin
          .from('interview_documents')
          .select('id')
          .eq('interview_job_id', interview_job_id)
          .eq('content_hash', contentHash)
          .maybeSingle();
        if (existing) {
          skippedDocs += 1;
          continue;
        }
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

      const chunks = chunkMarkdown(doc.markdown, {
        filename: doc.filename,
        docId: documentId,
      });
      if (chunks.length === 0) continue;

      // Publish the denominator before the first (slow) embed call so the
      // file card flips from a bare "인덱싱 중…" to "0 / N chunks (0%)" the
      // moment the client's 2s poll picks it up.
      await admin
        .from('interview_documents')
        .update({ total_chunks: chunks.length, processed_chunks: 0 })
        .eq('id', documentId);

      // Embed + insert in batches — 100 rows per call balances HTTP overhead
      // against PostgREST's per-request payload budget (HNSW index updates are
      // cheap on the write side at this scale). Embedding per-batch (rather
      // than all-at-once up front) is what lets processed_chunks advance
      // mid-file so the progress bar actually moves.
      const ROWS_PER_INSERT = 100;
      let processed = 0;
      for (let i = 0; i < chunks.length; i += ROWS_PER_INSERT) {
        const slice = chunks.slice(i, i + ROWS_PER_INSERT);
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
        const { error: chunkErr } = await admin
          .from('interview_chunks')
          .insert(rows);
        if (chunkErr) {
          console.error('[interviews/index] chunk insert failed', chunkErr);
          throw new Error('chunk_insert_failed');
        }
        processed += embedded.length;
        // Progress tick — best-effort; the client polls interview_documents.
        await admin
          .from('interview_documents')
          .update({ processed_chunks: processed })
          .eq('id', documentId);
      }
      totalChunks += processed;
    }

    await admin
      .from('interview_jobs')
      .update({ index_status: 'done' })
      .eq('id', interview_job_id)
      .eq('org_id', org.org_id);

    // 인덱싱 완료 → 탑라인 자동 생성(fire-and-forget). content_hash 동일하면
    // maybeKickTopline 내부에서 skip(재업로드 없는 재방문 = 비용 0). 프로젝트에
    // 소속된 문서일 때만 — 프로젝트 미지정(legacy) 업로드는 탑라인 대상 아님.
    const toplineProjectId = project_id ?? jobRow.project_id ?? null;
    if (toplineProjectId) {
      after(() =>
        maybeKickTopline(admin, {
          orgId: org.org_id,
          projectId: toplineProjectId,
        }).catch((e) =>
          console.error('[interviews/index] topline kick failed', e),
        ),
      );
    }

    return NextResponse.json({
      ok: true,
      document_count: totalDocs,
      chunk_count: totalChunks,
      skipped_count: skippedDocs,
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
