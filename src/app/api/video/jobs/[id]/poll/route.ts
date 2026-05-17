import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getIndexedAsset, analyzeVideo } from '@/lib/twelvelabs';
import { FEATURE_COSTS } from '@/lib/features';

export const maxDuration = 60;

const UX_ANALYSIS_PROMPT = `이 영상은 UX 리서치를 위한 사용자 테스트 또는 인터뷰 녹화본입니다. 다음 항목을 한국어 Markdown으로 분석해주세요.

형식 원칙:
- 존댓말(~입니다/~합니다/~보입니다) 사용
- 타임스탬프는 [MM:SS] 형식으로 모든 주요 순간에 명시
- 각 섹션 헤더에 이모지 포함
- 관찰한 사실만 기록하고 없는 내용은 만들지 않기

필수 섹션:

# 🎥 영상 분석 리포트

## 📋 개요
영상의 전체적인 내용, 시나리오, 컨텍스트를 3~5문장으로 요약합니다.

## 🔍 주요 발견 (Key Findings)
가장 중요한 UX 인사이트 3~5가지를 타임스탬프와 함께 서술합니다.

## ⚠️ 페인포인트 & 혼란 구간
사용자가 어려움·혼란·망설임을 보인 구체적인 순간들을 타임스탬프와 함께 기록합니다.

## ✅ 성공 & 자연스러운 흐름
사용자가 목표를 달성하거나 막힘 없이 진행한 구간을 타임스탬프와 함께 기록합니다.

## 💬 주요 발화 & 반응
사용자가 말한 의미 있는 발언이나 반응을 직접 인용 형식으로 타임스탬프와 함께 기록합니다. (발화가 없으면 이 섹션 생략)

## 🧭 UX 개선 제안
발견한 문제에 대한 구체적인 개선 방향 3~5가지를 제시합니다.

## 📊 분석 한계
영상 품질·길이·가시성 등으로 인해 파악하기 어려웠던 부분과 추가 조사가 필요한 영역을 간략히 기록합니다.`;

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

  // Already terminal
  if (job.status === 'done' || job.status === 'error') {
    return NextResponse.json({ status: job.status });
  }

  // Still uploading or no indexed-asset-id yet
  if (job.status === 'uploading' || !job.tl_indexed_asset_id) {
    return NextResponse.json({ status: job.status });
  }

  // Claude analysis running async — keep polling
  if (job.status === 'analyzing') {
    return NextResponse.json({ status: 'analyzing' });
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

  // Indexed and ready — flip to 'analyzing' and kick off Pegasus analysis
  const admin = createAdminClient();
  await admin
    .from('video_jobs')
    .update({ status: 'analyzing' })
    .eq('id', id);

  after(() =>
    runAnalysis({
      jobId: id,
      indexedAssetId: job.tl_indexed_asset_id!,
      filename: job.filename,
      orgId: job.org_id,
      userId: job.user_id,
    }),
  );

  return NextResponse.json({ status: 'analyzing' });
}

async function runAnalysis(args: {
  jobId: string;
  indexedAssetId: string;
  filename: string;
  orgId: string;
  userId: string;
}) {
  const { jobId, indexedAssetId, filename, orgId, userId } = args;
  const admin = createAdminClient();

  async function patch(update: Record<string, unknown>) {
    await admin.from('video_jobs').update(update).eq('id', jobId);
  }

  try {
    // Call Twelvelabs /analyze (Pegasus model)
    const analysis = await analyzeVideo(
      indexedAssetId,
      UX_ANALYSIS_PROMPT,
      4000,
    );

    const finalText = analysis.trim() || `# 🎥 영상 분석 리포트\n\n파일: ${filename}\n\n분석 결과를 생성하지 못했습니다. 영상 길이나 품질을 확인해주세요.`;

    const { data: gen } = await admin
      .from('generations')
      .insert({
        org_id: orgId,
        user_id: userId,
        feature: 'video',
        input: JSON.stringify({ filename, indexed_asset_id: indexedAssetId }),
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
