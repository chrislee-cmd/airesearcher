// Desk report export 렌더러 등록 — docx.
//
// 이동(move): docx 변환 로직 자체는 이미 `@/lib/desk-docx` 의 deskMarkdownToDocx
// 에 단일화돼 있다(기존 위젯은 POST /api/desk/export 로 클라 markdown 을 넘겨
// 이 함수를 호출). 단일 export 진입점은 클라가 아니라 **id 로 desk_jobs.output**
// 을 서버에서 읽어 같은 함수에 넘긴다 — 위젯 다운로드와 바이트 동일(같은 output
// 마크다운·같은 title 포맷·같은 filename 빌더). 위젯 배선 전환은 후속 PR.

import { registerRenderer } from '@/lib/artifacts/export-registry';
import { deskMarkdownToDocx } from '@/lib/desk-docx';
import { buildArtifactFilename } from '@/lib/filename';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

registerRenderer('desk', 'docx', async (_row, ctx) => {
  const { data: job } = await ctx.supabase
    .from('desk_jobs')
    .select('output, keywords, created_at')
    .eq('id', ctx.id)
    .single();
  const output = (job?.output as string | null) ?? null;
  if (!job || !output || output.trim().length === 0) {
    return { gate: 'not_ready' };
  }
  const keywords = Array.isArray(job.keywords)
    ? (job.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];
  // 위젯(desk-card-body) 과 동일한 title / filename 규약을 그대로 재현 → diff 0.
  const title =
    keywords.length > 0
      ? `데스크 리서치 — ${keywords.join(', ')}`
      : '데스크 리서치';
  const filename = buildArtifactFilename({
    prefix: 'desk',
    slug: keywords[0],
    createdAt: (job.created_at as string | null) ?? new Date(),
    ext: 'docx',
  });
  const buf = await deskMarkdownToDocx(output, title);
  return { body: new Uint8Array(buf), mime: DOCX_MIME, filename };
});
