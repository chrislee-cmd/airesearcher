import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  filename: z.string().min(1).max(300),
});

function safeFilename(name: string) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const cleanedBase = base
    .replace(/[\\/]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 120);
  const cleanedExt = ext.replace(/[^A-Za-z0-9.]+/g, '');
  return `${cleanedBase || 'file'}${cleanedExt}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { filename } = parsed.data;

  const ts = Date.now();
  const objectKey = `${user.id}/videos/${ts}-${safeFilename(filename)}`;

  const { data, error } = await supabase.storage
    .from('audio-uploads')
    .createSignedUploadUrl(objectKey);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'signed_url_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storage_key: objectKey,
    upload_url: data.signedUrl,
  });
}
