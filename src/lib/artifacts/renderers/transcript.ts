// Transcript export 렌더러 등록 — 변환 로직은 `@/lib/transcripts/export-render`
// (기존 다운로드 라우트와 공유, 출력 diff 0). 여기선 (feature, format) → 렌더러
// 매핑만 얹는다.

import { registerRenderer } from '@/lib/artifacts/export-registry';
import {
  isTranscriptFormat,
  renderTranscriptExport,
} from '@/lib/transcripts/export-render';

for (const format of ['docx', 'md', 'txt', 'srt'] as const) {
  registerRenderer('transcript', format, async (_row, ctx) => {
    if (!isTranscriptFormat(format)) return { gate: 'not_found' };
    // 미리보기 라우트와 동일하게 ?source=raw|clean 을 존중(기본 clean).
    const source =
      ctx.searchParams.get('source') === 'raw' ? 'raw' : 'clean';
    return renderTranscriptExport(ctx.supabase, ctx.id, format, source);
  });
}
