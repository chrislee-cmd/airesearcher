import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase/server';
import { markdownToDocx } from '@/lib/transcripts/docx';
import { buildArtifactBaseName } from '@/lib/filename';
import {
  applySpeakerLabels,
  type SpeakerRolesMap,
} from '@/lib/transcripts/speaker-roles';
import {
  applyInferredSpeakerLabels,
  type InferredSpeakersPayload,
} from '@/lib/transcripts/diarization';
import { selectWithInferredFallback } from '@/lib/transcripts/jobs-select';

// 여러 전사록을 한 번에 ZIP 으로 묶어 내려주는 벌크 다운로드. fullview 의
// 일괄 선택 → 📥 ZIP 다운로드가 이 엔드포인트를 window.location.href 로 연다.
// 개별 다운로드(`/jobs/[id]/download/[format]`)와 같은 라벨링 파이프라인을
// 재사용해 ZIP 안 파일 내용이 단건 다운로드와 동일하게 나오도록 한다.
export const maxDuration = 60;

// docx 는 큰 잡에서 시간이 걸리므로 상한을 둔다. 개별 DELETE 처럼 조작이
// 아니라 조회+생성이라 100건 상한이면 maxDuration 60s 안에 안전.
const MAX_IDS = 100;

type BulkJob = {
  id: string;
  filename: string | null;
  markdown: string | null;
  clean_markdown: string | null;
  speaker_roles: SpeakerRolesMap | null;
  inferred_speakers: InferredSpeakersPayload | null;
  meeting_summary: string | null;
  provider: string | null;
  status: string | null;
  created_at: string;
};

// 회의록 요약 블록을 전사 마크다운의 front-matter 직후에 삽입(단건 download 와
// 동일 동작). docx 는 markdownToDocx 의 opts 로 별 챕터 렌더.
function insertSummary(markdown: string, summary: string): string {
  const lines = markdown.split(/\r?\n/);
  let insertAt = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        insertAt = i + 1;
        break;
      }
    }
  }
  const head = lines.slice(0, insertAt).join('\n');
  const tail = lines.slice(insertAt).join('\n');
  return `${head}\n\n${summary.trim()}\n${tail}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // md | docx 만 허용. 그 외 값은 docx 로 보수적으로 처리(단건 라우트는
  // txt 도 지원하나 벌크는 spec 상 docx/md 두 포맷만).
  const format = url.searchParams.get('format') === 'md' ? 'md' : 'docx';

  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // RLS + 명시적 user_id 필터로 self-only. inferred_speakers 는 마이그
  // 미적용 환경에서 graceful degrade (jobs-select 헬퍼, PR #505 패턴).
  const baseColumns =
    'id, filename, markdown, clean_markdown, speaker_roles, provider, status, created_at';
  const { data, error } = await selectWithInferredFallback<BulkJob[]>(
    async (cols) => {
      const r = await supabase
        .from('transcript_jobs')
        .select(cols)
        .in('id', ids)
        .eq('user_id', user.id);
      return {
        data: (r.data as BulkJob[] | null) ?? null,
        error: r.error as { code?: string; message?: string } | null,
      };
    },
    baseColumns,
  );

  if (error) {
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  // done + markdown 있는 잡만 번들 (진행 중/실패 잡은 내용이 없어 제외).
  const ready = (data ?? []).filter(
    (j) => j.status === 'done' && !!j.markdown,
  );
  if (ready.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const zip = new JSZip();
  // ZIP 안 파일명 충돌 방지 — 같은 base 가 여러 번 나오면 -2, -3 … suffix.
  const usedNames = new Set<string>();
  let anonCounter = 0;

  for (const job of ready) {
    // 단건 다운로드와 동일: clean_markdown 우선, 없으면 raw markdown.
    const sourceMarkdown =
      (job.clean_markdown ?? job.markdown) as string;
    // 라벨 언어는 provider 로 추론 (deepgram=영어, else=한국어) — 단건 라우트와 동일.
    const labelLang = job.provider === 'deepgram' ? 'en' : 'ko';
    const labeled = job.inferred_speakers
      ? applyInferredSpeakerLabels(
          sourceMarkdown,
          job.inferred_speakers,
          labelLang,
        )
      : applySpeakerLabels(sourceMarkdown, job.speaker_roles, labelLang);

    // 파일명 base — 원본 filename(확장자 제거)이 사람이 읽을 만하면 그대로,
    // 아니면 session-N 으로. 단건 라우트는 여기서 user 잡 수를 세지만, 벌크는
    // 잡 100건 × count 쿼리가 비싸 로컬 index 로 보수적 대체(내용 동일).
    const rawBase = (job.filename ?? '').replace(/\.[^./]+$/, '').trim();
    const base = buildArtifactBaseName({
      prefix: 'transcript',
      slug: rawBase || `session-${++anonCounter}`,
      createdAt: job.created_at,
    });

    const ext = format === 'docx' ? 'docx' : 'md';
    let name = `${base}.${ext}`;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base}-${n}.${ext}`;
      n += 1;
    }
    usedNames.add(name);

    // 회의록 모드 잡이면 요약 + Todo 반영(리서치/실패 잡은 NULL → 현행 그대로).
    const summaryMarkdown = job.meeting_summary ?? undefined;
    if (format === 'docx') {
      const buf = await markdownToDocx(labeled, { summaryMarkdown });
      zip.file(name, new Uint8Array(buf));
    } else {
      zip.file(
        name,
        summaryMarkdown ? insertSummary(labeled, summaryMarkdown) : labeled,
      );
    }
  }

  const blob = await zip.generateAsync({ type: 'nodebuffer' });
  // created_at 기반이 아니라 요청 시각이라 Date.now() 로 충분 (서버 라우트).
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(blob), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="transcripts-${stamp}.zip"`,
      'content-length': String(blob.length),
    },
  });
}
