import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Interviews V2 — signed upload URL for DIRECT browser → Supabase Storage
// upload (pr-iv-upload-direct-storage). Mirrors /api/transcripts/upload-url
// exactly: the file bytes never pass through the Vercel function (which caps
// request bodies at 4.5MB and edge-rejected interview m4a uploads with a
// platform 413). The browser TUS-uploads straight to Storage under the user's
// own prefix, then hands only the object key to /api/interviews/convert.
//
// Bucket `audio-uploads` is reused (same as transcripts): its RLS
// (audio_user_insert: foldername[1] = auth.uid()) is satisfied by the
// `<userId>/…` key prefix, so no new migration/bucket is needed.

const Body = z.object({
  filename: z.string().min(1).max(300),
});

function safeFilename(name: string) {
  // Keep extension, strip directory traversal, replace spaces.
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { filename } = parsed.data;

  // Path: <userId>/<timestamp>-<safe_filename> — prefix keeps it inside the
  // user's RLS scope so convert can download it back with the same session.
  const ts = Date.now();
  const objectKey = `${user.id}/${ts}-${safeFilename(filename)}`;

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
    token: data.token,
  });
}
