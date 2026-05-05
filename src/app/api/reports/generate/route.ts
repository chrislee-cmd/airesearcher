import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { FEATURE_COSTS } from '@/lib/features';
import { classifyFile, extractDocText } from '@/lib/file-extract';

export const maxDuration = 300;

const MAX_FILES = 20;
const MAX_BYTES_PER_FILE = 25 * 1024 * 1024;
const MAX_TOTAL_INPUT_CHARS = 400_000;

const SYSTEM = `당신은 시니어 UX·마케팅 리서처입니다. 업로드된 인터뷰/리서치 자료들을 종합해서 \
한 편의 완성된 HTML 리포트 문서를 작성합니다. 출력은 **순수 HTML 문서 한 개만** 반환하세요. \
코드펜스(\`\`\`)·설명·머리말 없이 곧바로 \`<!doctype html>\` 으로 시작합니다.

요구사항:
1. 자체 완결적인 HTML — \`<!doctype html><html><head>\` ... \`<style>\` ... \`</style></head><body>\` ... \`</body></html>\`.
2. 외부 리소스(외부 CSS/JS/이미지) 참조 금지. 모든 스타일은 \`<style>\` 안에 인라인.
3. 디자인 톤: 에디토리얼·세리프 본문(예: "Pretendard", system-ui)·여백 넉넉·1px 보더·라운드 4px·단색 액센트(#C7372F)·그림자 없음.
4. 구조 (한국어):
   - 표제(상단 제목 + 한 줄 요약)
   - 핵심 인사이트 3~5개 (Executive Summary, 카드형 그리드)
   - 응답자 페르소나 / 세그먼트
   - 주요 테마(Theme) 별 섹션 — 각 테마마다 발견점 + 실제 발화 인용 + 시사점
   - 정량적 신호가 있다면 표로 정리
   - 권장 액션 (Recommendations)
   - 부록: 출처 파일 목록
5. 본문 인용은 \`<blockquote>\`로 감싸고, 인용 끝에 어떤 파일에서 왔는지 표기.
6. 입력 자료에 명시적으로 없는 사실을 만들어내지 마세요. 추론은 "추정" 표시.
7. 길이는 충분히 — 최소 1500단어 이상의 본문이 자연스럽습니다.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const formData = await request.formData();
  const entries = formData.getAll('files');
  const files: File[] = entries.filter((e): e is File => e instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'no_files' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: 'too_many_files' }, { status: 400 });
  }

  // Extract text from every uploaded file. Only docx + plain text/markdown
  // are accepted here — the dropzone already filters, but we re-check on
  // the server because nothing about a multipart request is trustworthy.
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
    if (kind !== 'text' && kind !== 'docx') {
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

  // Pack the bundle. Per-file budget keeps very large uploads from
  // monopolizing the prompt window.
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

  let html: string;
  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: SYSTEM,
      prompt: `다음은 업로드된 ${sources.length}개 자료입니다. 이 자료들을 종합하여 위 요구사항을 따르는 단일 HTML 리포트를 작성하세요.\n\n${corpus}`,
      temperature: 0.4,
      maxOutputTokens: 16384,
    });
    html = result.text.trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'llm_failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Strip any accidental code fences.
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  if (!/<!doctype html|<html/i.test(html)) {
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>리포트</title></head><body>${html}</body></html>`;
  }

  const inputSummary = sources.map((s) => s.name).join(', ');
  const { data: gen, error: insertErr } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'reports',
      input: inputSummary,
      output: html,
      credits_spent: FEATURE_COSTS.reports,
    })
    .select('id')
    .single();
  if (insertErr || !gen) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  const spend = await spendCredits(org.org_id, 'reports', gen.id);
  if (!spend.ok) {
    await supabase.from('generations').delete().eq('id', gen.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  return NextResponse.json({
    html,
    generation_id: gen.id,
    sources: sources.map((s) => s.name),
  });
}
