import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import { chunkMarkdown } from '@/lib/interview-chunking';
import { embedInterviewChunks } from '@/lib/interview-embed';

// PR-2 — manual re-trigger for the corpus indexer.
//
// Reached from the chat tab when interview_jobs.index_status is anything
// other than 'done'. Path-of-least-surprise: re-chunk and re-embed from
// the markdown the index endpoint already persisted in interview_documents.
//
// Trade-off captured in the spec: jobs created before PR-1 have no
// interview_documents row, so there's no markdown to re-index. The
// "complex" path would reconstruct mini-markdown from
// interview_jobs.extractions; we take the simple path and surface a
// dedicated error code (`no_corpus`) the UI can render as a user
// message. Follow-up PR: re-index pre-PR-1 jobs from extractions.

export const maxDuration = 300;

const ROWS_PER_INSERT = 100;

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

  const url = new URL(req.url);
  const jobId = url.searchParams.get('job_id');
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'invalid_job_id' }, { status: 400 });
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from('interview_jobs')
    .select('id, org_id, index_status')
    .eq('id', jobId)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  const admin = createAdminClient();

  // Load the markdown the original indexer persisted. The simple
  // re-trigger path requires at least one row here — pre-PR-1 jobs
  // pre-date this table entirely and need the complex follow-up path.
  const { data: docs, error: docsErr } = await admin
    .from('interview_documents')
    .select('id, filename, markdown')
    .eq('interview_job_id', jobId);
  if (docsErr) {
    console.error('[interviews/index/run-now] docs fetch failed', docsErr);
    return NextResponse.json({ error: 'docs_fetch_failed' }, { status: 500 });
  }
  if (!docs || docs.length === 0) {
    return NextResponse.json(
      { error: 'no_corpus' },
      { status: 409 },
    );
  }

  // Mark indexing immediately so the UI chip flips even before the
  // first chunk insert. Mirrors /api/interviews/index.
  await admin
    .from('interview_jobs')
    .update({ index_status: 'indexing' })
    .eq('id', jobId)
    .eq('org_id', org.org_id);

  try {
    // Wipe stale chunks so a partial / failed previous run can't leave
    // half-embedded rows behind. content_hash on interview_documents
    // already dedupes the documents themselves; chunks have no such
    // unique key, so explicit delete is the safest path.
    const { error: delErr } = await admin
      .from('interview_chunks')
      .delete()
      .eq('interview_job_id', jobId);
    if (delErr) {
      console.error('[interviews/index/run-now] chunk delete failed', delErr);
      throw new Error('chunk_delete_failed');
    }

    let totalChunks = 0;
    for (const doc of docs) {
      const chunks = chunkMarkdown(doc.markdown, {
        filename: doc.filename,
        docId: doc.id,
      });
      if (chunks.length === 0) continue;

      // Reset the progress counters for this re-index pass (a prior run may
      // have left them at 100%). Publish the denominator before embedding so
      // the card shows "0 / N chunks" straight away.
      await admin
        .from('interview_documents')
        .update({ total_chunks: chunks.length, processed_chunks: 0 })
        .eq('id', doc.id);

      let processed = 0;
      for (let i = 0; i < chunks.length; i += ROWS_PER_INSERT) {
        const slice = chunks.slice(i, i + ROWS_PER_INSERT);
        const embedded = await embedInterviewChunks(slice);
        const rows = embedded.map((c) => ({
          org_id: org.org_id,
          interview_job_id: jobId,
          document_id: doc.id,
          content: c.content,
          metadata: c.metadata,
          embedding: c.embedding_literal,
        }));
        const { error: chunkErr } = await admin
          .from('interview_chunks')
          .insert(rows);
        if (chunkErr) {
          console.error('[interviews/index/run-now] chunk insert failed', chunkErr);
          throw new Error('chunk_insert_failed');
        }
        processed += embedded.length;
        await admin
          .from('interview_documents')
          .update({ processed_chunks: processed })
          .eq('id', doc.id);
      }
      totalChunks += processed;
    }

    await admin
      .from('interview_jobs')
      .update({ index_status: 'done' })
      .eq('id', jobId)
      .eq('org_id', org.org_id);

    return NextResponse.json({
      ok: true,
      document_count: docs.length,
      chunk_count: totalChunks,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'index_failed';
    console.error('[interviews/index/run-now] failed', msg);
    try {
      await admin
        .from('interview_jobs')
        .update({ index_status: 'error' })
        .eq('id', jobId)
        .eq('org_id', org.org_id);
    } catch {
      // ignore
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
