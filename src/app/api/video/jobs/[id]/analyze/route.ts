import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { analyzeVideo } from '@/lib/twelvelabs';
import { DEFAULT_ANALYSIS_PROMPT } from '@/lib/video-prompts';
import { FEATURE_COSTS } from '@/lib/features';

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let prompt: string = DEFAULT_ANALYSIS_PROMPT;
  try {
    const body = (await request.json()) as { prompt?: unknown };
    if (typeof body.prompt === 'string' && body.prompt.trim().length > 0) {
      prompt = body.prompt.trim();
    }
  } catch {}

  const { data: job, error } = await supabase
    .from('video_jobs')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Must be indexed or error/done (for re-analyze)
  if (
    job.status !== 'indexed' &&
    job.status !== 'error' &&
    job.status !== 'done'
  ) {
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  if (!job.tl_asset_id) {
    return NextResponse.json({ error: 'no_asset' }, { status: 409 });
  }

  const admin = createAdminClient();
  await admin
    .from('video_jobs')
    .update({ status: 'analyzing', error_message: null, analysis: null })
    .eq('id', id);

  after(() =>
    runAnalysis({
      jobId: id,
      assetId: job.tl_asset_id!,
      filename: job.filename,
      orgId: job.org_id,
      userId: job.user_id,
      prompt,
    }),
  );

  return NextResponse.json({ status: 'analyzing' });
}

async function runAnalysis(args: {
  jobId: string;
  assetId: string;
  filename: string;
  orgId: string;
  userId: string;
  prompt: string;
}) {
  const { jobId, assetId, filename, orgId, userId, prompt } = args;
  const admin = createAdminClient();

  async function patch(update: Record<string, unknown>) {
    await admin.from('video_jobs').update(update).eq('id', jobId);
  }

  try {
    const analysis = await analyzeVideo(assetId, prompt, 4000);

    const finalText =
      analysis.trim() ||
      `# 🎥 영상 분석 리포트\n\n파일: ${filename}\n\n분석 결과를 생성하지 못했습니다. 영상 길이나 품질을 확인해주세요.`;

    const { data: gen } = await admin
      .from('generations')
      .insert({
        org_id: orgId,
        user_id: userId,
        feature: 'video',
        input: JSON.stringify({ filename, asset_id: assetId }),
        output: finalText,
        credits_spent: FEATURE_COSTS.video,
      })
      .select('id')
      .single();

    await patch({
      status: 'done',
      analysis: finalText,
      generation_id: gen?.id,
    });
  } catch (err) {
    console.error('[video] runAnalysis fatal', err);
    await patch({
      status: 'error',
      error_message: err instanceof Error ? err.message : 'analysis_failed',
    });
  }
}
