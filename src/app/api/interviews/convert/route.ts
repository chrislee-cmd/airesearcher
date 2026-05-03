import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { classifyFile, extractDocText } from '@/lib/file-extract';

export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

const SYSTEM = `당신은 인터뷰 텍스트를 깔끔한 Markdown 인터뷰 노트로 정리하는 작성자입니다.
- 인터뷰어의 질문은 \`## Q. <원문 질문>\` 형태로 시작합니다.
- 응답자의 답변은 질문 바로 아래 본문 단락으로 옮깁니다. 길면 단락을 나눕니다.
- 명백한 메타데이터(인터뷰 일자, 응답자 ID 등)가 있으면 문서 상단의 \`---\` YAML front matter로 정리합니다.
- 원문 의미를 임의로 요약하지 말고, 단순한 잡음(기침, 의미없는 추임새, "음", "어")만 제거합니다.
- 출력은 순수한 Markdown 텍스트만, 코드펜스/추가 설명 없이.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_openai_key' }, { status: 500 });
  }
  const openai = new OpenAI({ apiKey });

  let rawText = '';
  let stage = 'classify';
  try {
    const kind = classifyFile(file);
    if (kind === 'audio' || kind === 'video') {
      stage = 'transcribe';
      const tx = await openai.audio.transcriptions.create({
        file,
        model: 'gpt-4o-mini-transcribe',
        response_format: 'text',
      });
      rawText = typeof tx === 'string' ? tx : (tx as { text?: string }).text ?? '';
    } else if (kind === 'unsupported') {
      return NextResponse.json(
        { error: 'unsupported_file_type', mime: file.type, name: file.name },
        { status: 415 },
      );
    } else {
      stage = `extract_${kind}`;
      rawText = await extractDocText(file);
    }
    if (!rawText.trim()) {
      return NextResponse.json(
        { error: 'no_text_extracted', stage, name: file.name },
        { status: 422 },
      );
    }
  } catch (e) {
    const err = e instanceof Error ? e : new Error('extraction_failed');
    console.error('[interviews/convert] stage=%s name=%s', stage, file.name, err);
    return NextResponse.json(
      { error: err.message, stage, name: file.name, mime: file.type },
      { status: 502 },
    );
  }

  // Format raw transcript into structured Markdown.
  let markdown = '';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `파일명: ${file.name}\n\n원문 인터뷰 텍스트:\n\n${rawText}`,
        },
      ],
    });
    markdown = completion.choices[0]?.message?.content?.trim() ?? rawText;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'format_failed' },
      { status: 502 },
    );
  }

  const { data: gen, error: insertErr } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'quotes',
      input: file.name,
      output: markdown,
      credits_spent: 1,
    })
    .select('id')
    .single();

  if (insertErr || !gen) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }

  const spend = await spendCredits(org.org_id, 'quotes', gen.id);
  if (!spend.ok) {
    await supabase.from('generations').delete().eq('id', gen.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  return NextResponse.json({
    markdown,
    filename: file.name,
    generation_id: gen.id,
  });
}
