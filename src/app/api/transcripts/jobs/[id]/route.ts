import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // We pull `raw_result` here only to extract audit slices (cleanup,
  // term-normalize, number-normalize, speaker-roles). The full payload
  // (megabytes for long interviews) is then dropped — the UI just needs the
  // meta to render status lines.
  // inferred_speakers 컬럼은 마이그 (#505) prod 적용 전엔 없어서 select 실패.
  // selectWithInferredFallback 가 try-then-fallback 으로 graceful degrade.
  const baseColumns =
    'id, filename, mime_type, size_bytes, duration_seconds, speakers_count, status, error_message, markdown, clean_markdown, speaker_roles, raw_result, created_at, updated_at';
  const { data, error } = await selectWithInferredFallback<Record<string, unknown>>(
    async (cols) => {
      const r = await supabase
        .from('transcript_jobs')
        .select(cols)
        .eq('id', id)
        .single();
      return {
        data: r.data as Record<string, unknown> | null,
        error: r.error as { code?: string; message?: string } | null,
      };
    },
    baseColumns,
  );
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'not_found' },
      { status: 404 },
    );
  }

  const raw = data.raw_result as
    | {
        _cleanup?: unknown;
        _term_normalize?: unknown;
        _number_normalize?: unknown;
        _roles?: unknown;
        _diarization?: unknown;
      }
    | null;
  const { raw_result: _drop, ...rest } = data;
  void _drop;
  return NextResponse.json({
    ...rest,
    cleanup_audit: raw?._cleanup ?? null,
    term_normalize_audit: raw?._term_normalize ?? null,
    number_normalize_audit: raw?._number_normalize ?? null,
    roles_audit: raw?._roles ?? null,
    diarization_audit: raw?._diarization ?? null,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Best-effort: also remove the storage object so we don't leak audio.
  const { data: job } = await supabase
    .from('transcript_jobs')
    .select('storage_key')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('transcript_jobs').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (job?.storage_key) {
    await supabase.storage.from('audio-uploads').remove([job.storage_key]);
  }
  return NextResponse.json({ ok: true });
}
