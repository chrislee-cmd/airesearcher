import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import {
  createAsset,
  createIndexedAsset,
  getAnalyzeIndexId,
  isAssetStillProcessing,
} from '@/lib/twelvelabs';

export const maxDuration = 60;

const Body = z.object({
  storage_key: z.string().min(1),
  filename: z.string().min(1).max(300),
  size_bytes: z.number().int().positive().optional(),
});

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
  const { storage_key, filename, size_bytes } = parsed.data;

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  if (!process.env.TWELVELABS_API_KEY || !process.env.TWELVELABS_ANALYZE_INDEX_ID) {
    return NextResponse.json({ error: 'missing_twelvelabs_config' }, { status: 500 });
  }

  // Generate a signed download URL (1 hour) — Twelvelabs will pull the video from it
  const { data: signedData, error: signedErr } = await supabase.storage
    .from('audio-uploads')
    .createSignedUrl(storage_key, 3600);
  if (signedErr || !signedData) {
    return NextResponse.json(
      { error: signedErr?.message ?? 'signed_url_failed' },
      { status: 500 },
    );
  }

  const indexId = getAnalyzeIndexId();

  // Step 1: Create TL asset from the signed URL
  let assetId: string;
  try {
    assetId = await createAsset(signedData.signedUrl, filename);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'tl_asset_failed' },
      { status: 500 },
    );
  }

  // Step 2: Index the asset in the Pegasus+Marengo index.
  // TL needs to finish downloading/transcoding the asset before it accepts an
  // indexing request, which can take longer than this route's maxDuration
  // for large files. If the immediate attempt is rejected with
  // "asset is being processed", we store the job with no indexed-asset-id
  // and the poll route retries createIndexedAsset until it succeeds.
  let indexedAssetId: string | null = null;
  try {
    indexedAssetId = await createIndexedAsset(indexId, assetId);
  } catch (e) {
    if (!isAssetStillProcessing(e)) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'tl_index_failed' },
        { status: 500 },
      );
    }
    // Fall through with indexedAssetId=null — poll will retry.
  }

  // Insert DB job — status=indexing, client will poll to know when ready.
  // Credits are charged at analyze time (length-based), not on upload.
  const { data: job, error: insertErr } = await supabase
    .from('video_jobs')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      filename,
      size_bytes: size_bytes ?? null,
      storage_key,
      tl_asset_id: assetId,
      tl_indexed_asset_id: indexedAssetId,
      tl_index_id: indexId,
      status: 'indexing',
    })
    .select('id')
    .single();

  if (insertErr || !job) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'db_error' },
      { status: 500 },
    );
  }

  return NextResponse.json({ job_id: job.id });
}
