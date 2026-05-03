import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';

export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.json', '.log'];

function isTextFile(file: File) {
  if (file.type.startsWith('text/')) return true;
  if (file.type === 'application/json') return true;
  const lower = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isAudioOrVideo(file: File) {
  return file.type.startsWith('audio/') || file.type.startsWith('video/');
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }

  let transcript = '';

  try {
    if (isAudioOrVideo(file)) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
      }
      const openai = new OpenAI({ apiKey });
      const result = await openai.audio.transcriptions.create({
        file,
        model: 'gpt-4o-mini-transcribe',
        response_format: 'text',
      });
      transcript =
        typeof result === 'string'
          ? result
          : (result as { text?: string }).text ?? '';
    } else if (isTextFile(file)) {
      transcript = await file.text();
    } else {
      return NextResponse.json(
        { error: 'unsupported_file_type', mime: file.type, name: file.name },
        { status: 415 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'transcription_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Persist the generation, then spend a credit (atomic via RPC).
  const { data: gen, error: insertErr } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'quotes',
      input: file.name,
      output: transcript,
      credits_spent: 1,
    })
    .select('id')
    .single();

  if (insertErr || !gen) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  const spend = await spendCredits(org.org_id, 'quotes', gen.id);
  if (!spend.ok) {
    await supabase.from('generations').delete().eq('id', gen.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  return NextResponse.json({
    transcript,
    filename: file.name,
    generation_id: gen.id,
  });
}
