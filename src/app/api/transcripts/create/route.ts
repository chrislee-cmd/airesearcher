import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getLanguage } from '@/lib/transcripts/languages';
import { ELEVENLABS_API_MODEL } from '@/lib/transcripts/models';
import { resolveProjectId } from '@/lib/transcripts/project-guard';

// Row-first handoff — create the per-file transcript_jobs row at UPLOAD START,
// BEFORE the file finishes uploading and BEFORE the concurrency gate. The row
// starts as status='uploading' so it always exists and shows up in the list:
//   - upload succeeds → /api/transcripts/start (with job_id) flips it to
//     'submitting' and dispatches the provider,
//   - upload fails    → /api/transcripts/jobs/[id]/fail flips it to 'error'.
// This removes the "silent disappearance" where a large / gate-rejected upload
// left a storage object with no DB row (orphan). No credits are spent here —
// billing still happens only on completion (webhook / poll / text-extract).

const Body = z.object({
  storage_key: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  project_id: z.string().uuid().nullable().optional(),
  mode: z.enum(['research', 'meeting']).optional(),
  speaker_count: z.number().int().min(1).max(3).nullable().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const {
    storage_key,
    filename,
    mime_type,
    size_bytes,
    language,
    project_id,
    mode,
    speaker_count,
  } = parsed.data;

  // Provider/model are derived from language (same as /start) so the row is
  // fully formed from the start; /start reuses these without re-deriving.
  const langEntry = getLanguage(language);
  const provider = langEntry.provider;
  const apiModel =
    provider === 'deepgram' ? langEntry.dgModel : ELEVENLABS_API_MODEL;

  // FK-guard: transcript_jobs.project_id FK → interview_projects (the widget's
  // selection SSOT). A valid interview_projects id is preserved (attribution);
  // anything else (null/stale legacy id) degrades to null so the insert can't
  // violate transcript_jobs_project_id_fkey. See project-guard.ts.
  const validProjectId = await resolveProjectId(supabase, project_id, org.org_id);

  const { data: job, error: insertErr } = await supabase
    .from('transcript_jobs')
    .insert({
      org_id: org.org_id,
      project_id: validProjectId,
      user_id: user.id,
      storage_key,
      filename,
      mime_type: mime_type ?? null,
      size_bytes: size_bytes ?? null,
      provider,
      model: apiModel,
      mode: mode ?? 'research',
      speaker_count: speaker_count ?? null,
      status: 'uploading',
    })
    .select('id')
    .single();
  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'db_error' },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: job.id });
}
