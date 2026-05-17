import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  createIndexedAsset,
  getIndexedAsset,
  isAssetStillProcessing,
} from '@/lib/twelvelabs';

export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: job, error } = await supabase
    .from('video_jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Already terminal or waiting for user input — no action needed
  if (
    job.status === 'done' ||
    job.status === 'error' ||
    job.status === 'indexed' ||
    job.status === 'analyzing'
  ) {
    return NextResponse.json({ status: job.status });
  }

  if (job.status === 'uploading') {
    return NextResponse.json({ status: job.status });
  }

  // Retry indexing if /start couldn't get past the "asset still processing"
  // gate. Once createIndexedAsset succeeds, normal getIndexedAsset polling
  // kicks in on the next tick.
  if (!job.tl_indexed_asset_id) {
    if (!job.tl_asset_id) {
      return NextResponse.json({ status: job.status });
    }
    try {
      const newId = await createIndexedAsset(job.tl_index_id, job.tl_asset_id);
      const admin = createAdminClient();
      await admin
        .from('video_jobs')
        .update({ tl_indexed_asset_id: newId })
        .eq('id', id);
      return NextResponse.json({ status: 'indexing' });
    } catch (e) {
      if (isAssetStillProcessing(e)) {
        return NextResponse.json({ status: 'indexing' });
      }
      const msg = e instanceof Error ? e.message : 'tl_index_failed';
      const admin = createAdminClient();
      await admin.from('video_jobs').update({ status: 'error', error_message: msg }).eq('id', id);
      return NextResponse.json({ status: 'error', error: msg });
    }
  }

  // Status is 'indexing' — check Twelvelabs indexed-asset status
  let indexed;
  try {
    indexed = await getIndexedAsset(job.tl_index_id, job.tl_indexed_asset_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'tl_poll_failed';
    const admin = createAdminClient();
    await admin.from('video_jobs').update({ status: 'error', error_message: msg }).eq('id', id);
    return NextResponse.json({ status: 'error', error: msg });
  }

  if (indexed.status === 'failed') {
    const admin = createAdminClient();
    await admin
      .from('video_jobs')
      .update({ status: 'error', error_message: 'twelvelabs_indexing_failed' })
      .eq('id', id);
    return NextResponse.json({ status: 'error' });
  }

  if (indexed.status !== 'ready') {
    return NextResponse.json({ status: 'indexing' });
  }

  // Indexing done — flip to 'indexed' and wait for user to submit a prompt.
  // Capture duration so the analyze route can charge length-based credits.
  const durationSec = indexed.system_metadata?.duration;
  const admin = createAdminClient();
  await admin
    .from('video_jobs')
    .update({
      status: 'indexed',
      duration_seconds: typeof durationSec === 'number' ? Math.round(durationSec) : null,
    })
    .eq('id', id);

  return NextResponse.json({ status: 'indexed' });
}
