import { NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { classifyFile, extractDocText } from '@/lib/file-extract';
import { coerceReportType } from '@/lib/reports/types';
import { getReportPrompts } from '@/lib/reports/prompts';

// Pro plan allows up to 800s for Serverless Functions; pair with a
// matching maxOutputTokens below so very long reports don't truncate.
export const maxDuration = 800;

const MAX_FILES = 20;
const MAX_BYTES_PER_FILE = 25 * 1024 * 1024;
const MAX_TOTAL_INPUT_CHARS = 400_000;

// Stage 1 of the report pipeline: take heterogeneous uploads (interview
// docx, free-form md, raw text) and normalize them into a single
// canonical Markdown document with strict section headers. Stage 2 reads
// only this MD, so its prompt stays tight and the final HTML always has
// the same skeleton regardless of how messy the inputs were.
//
// Schema/emphasis is selected per `reportType` from the form payload —
// the four directions (design / marketing / strategy / findings) each
// produce a differently-shaped canonical markdown, so stage 2 inherits
// the analytical lens, not just visual tone. Prompts live under
// src/lib/reports/prompts/<type>.ts.

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const formData = await request.formData();
  const reportType = coerceReportType(formData.get('reportType'));
  const prompts = getReportPrompts(reportType);
  const entries = formData.getAll('files');
  const files: File[] = entries.filter((e): e is File => e instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  }

  const sources: { name: string; text: string }[] = [];
  for (const file of files) {
    if (file.size === 0) continue;
    if (file.size > MAX_BYTES_PER_FILE) {
      return NextResponse.json(
        { error: 'file_too_large', name: file.name },
        { status: 413 },
      );
    }
    const kind = classifyFile(file);
    if (kind !== 'text' && kind !== 'docx' && kind !== 'xlsx') {
      return NextResponse.json(
        { error: 'unsupported_file_type', name: file.name },
        { status: 415 },
      );
    }
    try {
      const text = await extractDocText(file);
      if (text.trim()) sources.push({ name: file.name, text });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'extraction_failed';
      return NextResponse.json(
        { error: msg, name: file.name },
        { status: 502 },
      );
    }
  }
  if (sources.length === 0) {
    return NextResponse.json({ error: 'no_text_extracted' }, { status: 422 });
  }

  const perFileBudget = Math.max(
    8_000,
    Math.floor(MAX_TOTAL_INPUT_CHARS / sources.length),
  );
  const corpus = sources
    .map((s) => {
      const body = s.text.length > perFileBudget
        ? `${s.text.slice(0, perFileBudget)}\n\n[...truncated ${s.text.length - perFileBudget} chars]`
        : s.text;
      return `===== FILE: ${s.name} =====\n${body}`;
    })
    .join('\n\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: prompts.NORMALIZE_SYSTEM,
    prompt: `다음은 업로드된 ${sources.length}개 자료입니다. 위 스키마를 따라 표준 양식 Markdown으로 정리하세요.\n\n${corpus}`,
    temperature: prompts.TEMPERATURE.normalize,
    maxOutputTokens: 64000,
  });

  return result.toTextStreamResponse();
}
