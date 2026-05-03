import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('transcript_jobs')
    .select(
      'id, filename, mime_type, size_bytes, duration_seconds, speakers_count, status, error_message, markdown, created_at, updated_at',
    )
    .eq('id', id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
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
