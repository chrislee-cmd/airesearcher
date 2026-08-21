import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
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

// ── Cross-hop resume (카드 #608) ──────────────────────────────────────────
// 프로덕션 인시던트 2026-08-21: 9파일(대용량 297청크 포함) 업로드가 maxDuration
// (300s) 한 함수 호출 안에서 배치 전체를 동기 임베딩+HNSW 삽입하다 5분 벽을 넘겨
// **플랫폼에 강제 종료(uncatchable)** → 완료 마킹(done/error)에 도달 못 해 잡이
// index_status='indexing' 에 26~48분째 영구 정지했다. #1304(원자성=catchable
// throw 만)·#1305(파일 내 청크 재시도)는 **함수-레벨 kill** 을 못 잡는다 — 이
// PR 이 그 구멍을 메운다(탑라인 durable-resume 패턴 이식).
//
// 한 홉은 시간예산(INDEX_HOP_BUDGET_MS) 안에서 처리 가능한 만큼만 진행하고, 남은
// 작업이 있으면 kill 전에 **자발적으로 yield** — 새 함수 호출(신선한 300s)을
// self-kick 해 이어간다. 죽은 홉은 /api/cron/index-resume-sweep 이 재점화한다.
// 재개는 markdown 을 interview_documents(이미 영속됨)에서 reload 하고, 파일별로
// 이미 삽입된 청크 수만큼 건너뛰어(count-based, 결정적 chunkMarkdown) 이어가므로
// **멱등**하다 — 청크 중복 삽입 0, 완료분 재작업 0.

// 한 홉의 처리 예산. maxDuration(300s) 에서 넉넉한 헤드룸(≈90s)을 남겨 마지막
// 배치(느린 HNSW insert + 재시도 백오프)와 재점화 kick 이 kill 전에 끝나게 한다.
const INDEX_HOP_BUDGET_MS = 210_000;

// interview_jobs.updated_at heartbeat 주기. 청크 진행은 interview_documents 를
// update 하므로 interview_jobs.updated_at 은 자동으로 안 바뀐다 → 주기적으로 잡을
// touch(트리거 touch_interview_jobs 가 updated_at bump)해 살아 있는 홉이 sweep 의
// stale 창(INDEX_STALE_MS, 4분)에 오탐되지 않게 한다.
const INDEX_HEARTBEAT_MS = 20_000;

// 재점화 kick 재시도 — self-fetch 가 조용히 실패(cold start·과부하)하면 체인이
// 끊긴다. 몇 번 재시도해 단절 확률을 낮춘다(끊겨도 sweep cron 이 백스톱).
const KICK_RESUME_ATTEMPTS = 3;

type AdminClient = ReturnType<typeof createAdminClient>;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// 재개 홉을 kick 할 배포 base URL — preview 는 자기 자신으로 라우팅되게
// deployment-specific VERCEL_URL 을 우선(topline kickResume 와 동일 패턴).
export function getDeploymentBaseUrl(): string {
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL;
  return 'http://localhost:3000';
}

/**
 * 다음 인덱싱 재개 홉을 kick — 신선한 300s 함수 호출로 이어간다. 이 route 를
 * `{ interview_job_id, resume: true }` + CRON_SECRET Bearer 로 self-POST 한다
 * (세션 없이 동작). sweep cron 도 이 함수를 재사용한다.
 *
 * @returns 한 번이라도 접수(2xx)됐으면 true.
 */
export async function retriggerIndex(
  jobId: string,
  attempts = KICK_RESUME_ATTEMPTS,
): Promise<boolean> {
  const base = getDeploymentBaseUrl();
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base}/api/interviews/index`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.CRON_SECRET}`,
        },
        body: JSON.stringify({ interview_job_id: jobId, resume: true }),
        // 가벼운 kick — 무한 대기 방지 타임아웃.
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return true;
      console.warn(
        '[interviews/index] resume kick non-ok',
        res.status,
        `(${i + 1}/${attempts})`,
      );
    } catch (e) {
      console.error(
        `[interviews/index] resume kick failed (${i + 1}/${attempts})`,
        e instanceof Error ? e.message : e,
      );
    }
    if (i < attempts - 1) await sleep(1_000 * (i + 1)); // 1s, 2s 백오프.
  }
  console.error(
    `[interviews/index] resume kick exhausted ${attempts} attempts — chain may stall; index-resume-sweep cron is backstop`,
  );
  return false;
}

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

// 최초 인덱싱 요청(client 세션) — markdown 을 body 로 싣고 온다.
const Body = z.object({
  interview_job_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  documents: z.array(DocumentBody).min(1).max(50),
});

// 재개 홉(self-kick / cron sweep, CRON_SECRET Bearer) — markdown 은 body 로 안
// 온다. interview_documents 에서 reload 한다.
const ResumeBody = z.object({
  interview_job_id: z.string().uuid(),
  resume: z.literal(true),
});

type IndexCtx = { orgId: string; jobId: string };

type PreparedDoc = {
  documentId: string;
  filename: string;
  markdown: string;
  // 재개 후보(이미 존재하는 문서 row): 삽입된 청크 수만큼 건너뛴다.
  isExisting: boolean;
};

type PassResult = {
  // 시간예산 초과로 자발적 yield 했는가(남은 작업 있음 → 재점화 필요).
  yielded: boolean;
  failed: { filename: string; reason: string }[];
  // 이번 홉에서 새로 삽입한 청크 수.
  totalChunks: number;
  // 이미 완전 인덱싱돼 건너뛴 문서 수.
  skippedDocs: number;
};

/** interview_jobs 를 touch 해 updated_at(heartbeat) 을 bump. index_status 는
 * 'indexing' 그대로 — 살아 있는 홉임을 sweep 에 알린다. best-effort. */
async function touchHeartbeat(admin: AdminClient, ctx: IndexCtx): Promise<void> {
  await admin
    .from('interview_jobs')
    .update({ index_status: 'indexing' })
    .eq('id', ctx.jobId)
    .eq('org_id', ctx.orgId);
}

/** 잡의 총 삽입 청크 수 — 진전(progress) 판정 기준. */
async function countJobChunks(admin: AdminClient, ctx: IndexCtx): Promise<number> {
  const { count } = await admin
    .from('interview_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('interview_job_id', ctx.jobId);
  return count ?? 0;
}

/**
 * 준비된 문서들을 시간예산 안에서 임베딩+삽입한다. 파일별로 이미 삽입된 청크 수
 * 만큼 건너뛰고(재개), 각 배치마다 processed_chunks 를 갱신(파일단위 진행 보존)
 * 한다. 예산 초과 시 현재까지 커밋하고 yielded=true 로 반환 — 호출측이 재점화한다.
 * 파일 단위 실패(catchable)는 failed[] 로 격리하고 계속한다(#1304 정합).
 */
async function processPreparedDocs(
  admin: AdminClient,
  ctx: IndexCtx,
  prepared: PreparedDoc[],
  startTime: number,
): Promise<PassResult> {
  const failed: { filename: string; reason: string }[] = [];
  let totalChunks = 0;
  let skippedDocs = 0;
  let lastHeartbeat = startTime;

  for (const doc of prepared) {
    // 파일 시작 전 예산 체크 — 다음 파일을 시작하면 kill 될 위험이면 yield.
    if (Date.now() - startTime > INDEX_HOP_BUDGET_MS) {
      console.warn('[interviews/index] hop yield (file boundary)', {
        jobId: ctx.jobId,
        filename: doc.filename,
      });
      return { yielded: true, failed, totalChunks, skippedDocs };
    }

    try {
      const chunks = chunkMarkdown(doc.markdown, {
        filename: doc.filename,
        docId: doc.documentId,
      });
      if (chunks.length === 0) continue;

      // Resume point. chunkMarkdown is deterministic + each batch insert is
      // all-or-nothing (a timed-out statement is cancelled whole → zero rows),
      // so the chunks already in the table are exactly the leading prefix
      // chunks[0..N-1]. count(*) is authoritative (processed_chunks may lag a
      // crash). Fresh document rows (first hop, just inserted) start at 0.
      let resumeFrom = 0;
      if (doc.isExisting) {
        const { count } = await admin
          .from('interview_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', doc.documentId);
        resumeFrom = count ?? 0;
        if (resumeFrom >= chunks.length) {
          // Fully indexed already — a true duplicate or a file finished on an
          // earlier hop. Nothing to resume; the per-file gate (processed>=total)
          // already lets the frontend treat it as done.
          skippedDocs += 1;
          continue;
        }
      }

      // Publish the denominator (+ resume offset) before the first (slow) embed
      // so the file card flips from a bare "인덱싱 중…" to "N / M chunks".
      await admin
        .from('interview_documents')
        .update({ total_chunks: chunks.length, processed_chunks: resumeFrom })
        .eq('id', doc.documentId);

      // Adaptive batch size — larger files get smaller inserts so per-statement
      // HNSW work stays under the (raised) statement_timeout.
      const rowsPerInsert = rowsPerInsertFor(chunks.length);

      let processed = resumeFrom;
      for (let i = resumeFrom; i < chunks.length; i += rowsPerInsert) {
        // 배치 시작 전 예산 체크 — 초과면 파일 중간에서라도 yield(다음 홉이
        // resumeFrom=processed 부터 이어감). processed_chunks 는 이미 커밋돼 있다.
        if (Date.now() - startTime > INDEX_HOP_BUDGET_MS) {
          console.warn('[interviews/index] hop yield (mid-file)', {
            jobId: ctx.jobId,
            filename: doc.filename,
            cursor: `${processed}/${chunks.length}`,
          });
          totalChunks += processed - resumeFrom;
          return { yielded: true, failed, totalChunks, skippedDocs };
        }

        // Heartbeat — bump interview_jobs.updated_at so a live hop isn't swept.
        if (Date.now() - lastHeartbeat > INDEX_HEARTBEAT_MS) {
          await touchHeartbeat(admin, ctx);
          lastHeartbeat = Date.now();
        }

        const slice = chunks.slice(i, i + rowsPerInsert);
        const embedded = await embedInterviewChunks(slice);
        const rows = embedded.map((c) => ({
          org_id: ctx.orgId,
          interview_job_id: ctx.jobId,
          document_id: doc.documentId,
          content: c.content,
          metadata: c.metadata,
          // pgvector accepts the literal string and casts implicitly.
          embedding: c.embedding_literal,
        }));
        // Insert via the RPC (raised statement_timeout) with retry/backoff.
        // Throws `chunk_insert_failed: …` on give-up; the partially-inserted
        // chunks stay (deterministic prefix) so the next hop resumes exactly here.
        await insertInterviewChunks(admin, rows);
        processed += embedded.length;
        await admin
          .from('interview_documents')
          .update({ processed_chunks: processed })
          .eq('id', doc.documentId);
      }
      // Count only chunks inserted this run (resumeFrom were already in the table).
      totalChunks += processed - resumeFrom;
    } catch (docErr) {
      // 이 파일만 실패로 기록하고 다음 파일로 — throw 하지 않는다. 부분 삽입된
      // 청크는 그대로 두어(dedup/idempotent) 다음 시도가 이어받게 하고, 사유만 모은다.
      const reason = docErr instanceof Error ? docErr.message : 'index_failed';
      console.error('[interviews/index] document failed', {
        filename: doc.filename,
        reason,
      });
      failed.push({ filename: doc.filename, reason });
      continue;
    }
  }

  return { yielded: false, failed, totalChunks, skippedDocs };
}

/**
 * 홉 종료 처리 — yield 면 진전 커서 갱신 + 재점화, 아니면 failed[] 기준으로 잡을
 * done/error 로 종결한다. 최초·재개 홉이 공유한다.
 */
async function finalize(
  admin: AdminClient,
  ctx: IndexCtx,
  result: PassResult,
  docsCount: number,
  totalDocs: number,
): Promise<NextResponse> {
  if (result.yielded) {
    // 자발적 yield = 이 홉에서 진전이 있었다(예산 안에서 최소 1배치 처리). 진전
    // 커서를 현재 삽입량으로 갱신하고 resume_count 를 0 리셋(healthy hop) — sweep
    // 의 진전-없음 카운터가 healthy 재개로는 누적되지 않게. 그 뒤 재점화한다.
    const currentTotal = await countJobChunks(admin, ctx);
    await admin
      .from('interview_jobs')
      .update({ index_cursor: currentTotal, index_resume_count: 0 })
      .eq('id', ctx.jobId)
      .eq('org_id', ctx.orgId);
    await retriggerIndex(ctx.jobId);
    return NextResponse.json({
      ok: true,
      yielded: true,
      chunk_count: result.totalChunks,
      skipped_count: result.skippedDocs,
    });
  }

  const { failed } = result;
  if (failed.length > 0 && failed.length === docsCount) {
    // 전부 실패 — 근거 0. error 로 마킹 + 중앙 관측 적재.
    const detail = failed.map((f) => `${f.filename}: ${f.reason}`).join('; ');
    await admin
      .from('interview_jobs')
      .update({ index_status: 'error', error_message: detail.slice(0, 500) })
      .eq('id', ctx.jobId)
      .eq('org_id', ctx.orgId);
    await logError({
      feature: 'interview',
      code: 'index_failed',
      message: detail,
      context: { interview_job_id: ctx.jobId, org_id: ctx.orgId },
    });
    return NextResponse.json(
      { error: 'index_failed', failed_count: failed.length },
      { status: 500 },
    );
  }

  if (failed.length > 0) {
    // 부분 성공 — 완료 파일은 즉시 사용 가능해야 하므로 job 은 'done', 상세 실패만
    // error_message 에 기록한다. 완료 파일별 게이트는 프론트가 processed>=total 로 판정.
    const detail = `partial: ${failed.length}/${docsCount} failed — ${failed
      .map((f) => `${f.filename}: ${f.reason}`)
      .join('; ')}`;
    console.error('[interviews/index] partial batch', { jobId: ctx.jobId, failed });
    await admin
      .from('interview_jobs')
      .update({ index_status: 'done', error_message: detail.slice(0, 500) })
      .eq('id', ctx.jobId)
      .eq('org_id', ctx.orgId);
  } else {
    // 전부 성공 — 이전 실패 흔적(error_message)이 남아 있으면 함께 지운다.
    await admin
      .from('interview_jobs')
      .update({ index_status: 'done', error_message: null })
      .eq('id', ctx.jobId)
      .eq('org_id', ctx.orgId);
  }

  // 인덱싱은 문서·청크 적재까지만 — 탑라인 생성은 여기서 자동으로 kick 하지 않는다
  // (카드 #474). 사용자가 명시적으로 "탑라인 생성" CTA 를 누를 때까지 Opus 를 안 돌린다.
  return NextResponse.json({
    ok: true,
    document_count: totalDocs,
    chunk_count: result.totalChunks,
    skipped_count: result.skippedDocs,
    failed_count: failed.length,
  });
}

/**
 * 재개 홉(self-kick / cron sweep). markdown 을 interview_documents 에서 reload 해
 * 이어서 인덱싱한다. CRON_SECRET Bearer 로만 도달 — 세션/rate-limit 없이 동작.
 */
async function handleResume(jobId: string): Promise<NextResponse> {
  const admin = createAdminClient();

  const { data: jobRow, error: jobErr } = await admin
    .from('interview_jobs')
    .select('id, org_id, index_status')
    .eq('id', jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  // 이미 done/error/pending 으로 넘어간 잡은 재개 대상 아님(경합 no-op).
  if (jobRow.index_status !== 'indexing') {
    return NextResponse.json({ ok: true, skipped: 'not_indexing' });
  }

  const ctx: IndexCtx = { orgId: jobRow.org_id, jobId };

  // markdown 은 최초 홉이 이미 interview_documents 에 영속했다. reload → 재개.
  const { data: docs, error: docsErr } = await admin
    .from('interview_documents')
    .select('id, filename, markdown')
    .eq('interview_job_id', jobId);
  if (docsErr) {
    console.error('[interviews/index] resume docs fetch failed', docsErr);
    return NextResponse.json({ error: 'docs_fetch_failed' }, { status: 500 });
  }
  if (!docs || docs.length === 0) {
    // indexing 인데 문서가 없다 = 최초 홉이 문서 영속 전에 죽었거나 손상. 정직하게
    // error 로 종결(영구 indexing 방지).
    await admin
      .from('interview_jobs')
      .update({ index_status: 'error', error_message: 'no_corpus_on_resume' })
      .eq('id', jobId)
      .eq('org_id', ctx.orgId);
    return NextResponse.json({ error: 'no_corpus' }, { status: 409 });
  }

  // 재개 홉 진입 즉시 heartbeat — sweep 이 방금 잡은 row 를 재-catch 하지 않게.
  await touchHeartbeat(admin, ctx);

  const prepared: PreparedDoc[] = docs.map((d) => ({
    documentId: d.id,
    filename: d.filename,
    markdown: d.markdown,
    isExisting: true,
  }));

  const startTime = Date.now();
  try {
    const result = await processPreparedDocs(admin, ctx, prepared, startTime);
    return finalize(admin, ctx, result, docs.length, 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'index_failed';
    console.error('[interviews/index] resume failed', msg);
    try {
      await admin
        .from('interview_jobs')
        .update({ index_status: 'error', error_message: msg.slice(0, 500) })
        .eq('id', jobId)
        .eq('org_id', ctx.orgId);
    } catch {
      // ignore
    }
    await logError({
      feature: 'interview',
      code: 'index_failed',
      message: msg,
      context: { interview_job_id: jobId, org_id: ctx.orgId },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const raw: unknown = await req.json().catch(() => null);

  // ── 재개 홉(내부 호출: self-kick / cron sweep) ──
  // CRON_SECRET Bearer + { resume: true } 조합만 재개 경로로 라우팅. markdown 은
  // DB 에서 reload 하므로 세션/rate-limit 불필요.
  const bearer = req.headers.get('authorization') ?? '';
  const isInternal = bearer === `Bearer ${env.CRON_SECRET}`;
  if (isInternal) {
    const resumeParsed = ResumeBody.safeParse(raw);
    if (resumeParsed.success) {
      return handleResume(resumeParsed.data.interview_job_id);
    }
  }

  // ── 최초 홉(client 세션) ──
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

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    // Distinguish the batch-size ceiling from generic validation failures so
    // the client can react (re-split) and logs show the real cause.
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
  const { data: jobRow, error: jobErr } = await supabase
    .from('interview_jobs')
    .select('id, org_id, project_id, index_status')
    .eq('id', interview_job_id)
    .single();
  if (jobErr || !jobRow) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }

  // Admin client for the heavy writes.
  const admin = createAdminClient();
  const ctx: IndexCtx = { orgId: org.org_id, jobId: interview_job_id };

  // Mark 'indexing' + reset the resume bookkeeping for this fresh pass. The
  // chip flips immediately; index_cursor/index_resume_count start clean so a
  // re-uploaded job doesn't inherit a stale stuck-counter.
  await admin
    .from('interview_jobs')
    .update({ index_status: 'indexing', index_cursor: 0, index_resume_count: 0 })
    .eq('id', interview_job_id)
    .eq('org_id', org.org_id);

  try {
    // ── Pass 1: persist ALL document rows up front (markdown, fast — no embed).
    // This is what makes a later hop's resume DB-only: a hop that yields (or
    // dies) mid-embed can reload every file's markdown from interview_documents
    // instead of the request body it no longer has. Dedupe/skip logic unchanged.
    const prepared: PreparedDoc[] = [];
    let totalDocs = 0;
    let preSkipped = 0;

    for (const doc of documents) {
      const contentHash = hashString(doc.markdown);
      // content_hash is the hash of the normalized markdown — a true content
      // match even across batches, jobs, or renamed files.
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
      // Whether this document row already existed (a re-run / true duplicate).
      // Existing rows are resume candidates — not skipped outright (incident
      // 2026-08-18: a file that timed out mid-insert would re-run, find its own
      // row, and skip → the missing chunks were never filled in).
      let isExisting = false;

      if (resolvedProjectId) {
        // Project-scoped dedupe — atomic insert-or-skip via
        // interview_documents_project_hash_uq: ON CONFLICT DO NOTHING.
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
            // Conflict reported but the row can't be read back — skip rather
            // than risk a duplicate insert.
            preSkipped += 1;
            continue;
          }
          documentId = existing.id;
          isExisting = true;
        } else {
          documentId = insertedRows[0].id;
          totalDocs += 1;
        }
      } else {
        // Legacy project-less path — job-scoped dedupe.
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

      prepared.push({
        documentId,
        filename: doc.filename,
        markdown: doc.markdown,
        isExisting,
      });
    }

    // ── Pass 2: budget-aware embed + insert (shared with the resume hop).
    const result = await processPreparedDocs(admin, ctx, prepared, Date.now());
    result.skippedDocs += preSkipped;
    return finalize(admin, ctx, result, prepared.length, totalDocs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'index_failed';
    console.error('[interviews/index] failed', msg);
    // Best-effort failure marker — never let the bookkeeping shadow the
    // original error.
    try {
      await admin
        .from('interview_jobs')
        .update({ index_status: 'error', error_message: msg.slice(0, 500) })
        .eq('id', interview_job_id)
        .eq('org_id', org.org_id);
    } catch {
      // ignore
    }
    await logError({
      feature: 'interview',
      code: 'index_failed',
      message: msg,
      context: { interview_job_id, org_id: org.org_id },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
