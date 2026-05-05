import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';
import { classifyFile, extractDocText } from '@/lib/file-extract';
import {
  tryRegexMarkdown,
  tryMarkdownPassthrough,
} from '@/lib/markdown-format';
import { hashBytes, getCache, setCache } from '@/lib/cache';

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

  // Content-addressed cache check. Same bytes = same markdown, regardless
  // of who uploads it. Bump CACHE_V if SYSTEM prompt or output shape changes.
  const CACHE_V = 'v4';
  const fileBuffer = await file.arrayBuffer();
  const fileHash = hashBytes(fileBuffer);
  const cacheKey = `interviews:convert:${CACHE_V}:${fileHash}`;
  const cached = await getCache<{
    markdown: string;
    format_path: 'regex' | 'llm';
    input_chars: number;
    output_chars: number;
  }>(cacheKey);
  if (cached) {
    return NextResponse.json({
      ...cached,
      filename: file.name,
      cached: true,
    });
  }

  // Lazy OpenAI client — only built when the path actually needs it
  // (audio/video transcription, or LLM markdown fallback).
  let _openai: OpenAI | null = null;
  function getOpenAI(): OpenAI {
    if (_openai) return _openai;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('missing_openai_key');
    _openai = new OpenAI({ apiKey });
    return _openai;
  }

  let rawText = '';
  let stage = 'classify';
  try {
    const kind = classifyFile(file);
    if (kind === 'audio' || kind === 'video') {
      stage = 'transcribe';
      // Re-wrap the buffered bytes since we already consumed file.arrayBuffer()
      // for hashing — the original File instance is still usable but reading
      // its body twice would re-stream. Build a fresh File from the buffer.
      const audioFile = new File([fileBuffer], file.name, {
        type: file.type || 'application/octet-stream',
      });
      const tx = await getOpenAI().audio.transcriptions.create({
        file: audioFile,
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
      // Same trick — feed the already-buffered bytes back as a File so
      // extractDocText doesn't try to drain a stream we already consumed.
      const docFile = new File([fileBuffer], file.name, {
        type: file.type || 'application/octet-stream',
      });
      rawText = await extractDocText(docFile);
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
  // Path 1 (regex): consistent speaker labels (M:/R:, Q:/A:, 진행자:/응답자:).
  // Path 2 (passthrough): extracted text already has structure (headers,
  //   lists, paragraph breaks, or code fences). No LLM call → no output-
  //   token cap → no silent truncation. Covers most user-uploaded .md and
  //   .docx interviews where each speaker line is its own paragraph.
  // Path 3 (llm): unstructured transcripts (Whisper output, free-form
  //   notes). Anthropic Sonnet 4.6 with explicit maxOutputTokens=16k.
  // Path 4 (raw fallback): if Sonnet fails (rate limit, network, etc.),
  //   fall through to raw text rather than 502'ing the whole request.
  //   Better to give the user the unformatted markdown + low-retention
  //   warning than to lose the conversion entirely.
  let markdown: string;
  let formatPath: 'regex' | 'llm' = 'regex';
  const regexMd = tryRegexMarkdown(rawText, file.name);
  const passthroughMd = regexMd ? null : tryMarkdownPassthrough(rawText, file.name);
  if (regexMd) {
    markdown = regexMd;
  } else if (passthroughMd) {
    markdown = passthroughMd;
  } else {
    formatPath = 'llm';
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      // No LLM available → degrade to raw text rather than blocking upload.
      console.warn('[interviews/convert] no anthropic key, using raw fallback', file.name);
      markdown = `---\nfile: ${file.name}\n---\n\n${rawText.replace(/\r\n?/g, '\n').trim()}\n`;
    } else {
      try {
        const anthropic = createAnthropic({ apiKey: anthropicKey });
        const result = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: SYSTEM,
          prompt: `파일명: ${file.name}\n\n원문 인터뷰 텍스트:\n\n${rawText}`,
          temperature: 0.2,
          maxOutputTokens: 16384,
        });
        markdown = result.text.trim() || rawText;
      } catch (e) {
        // Common case: Anthropic per-minute rate limit on big inputs.
        // Don't 502 — the downstream extract step is willing to work on
        // raw text. The retention badge already flags low retention; here
        // we keep retention high by skipping the formatter entirely.
        const msg = e instanceof Error ? e.message : 'format_failed';
        console.warn('[interviews/convert] llm format failed, raw fallback:', file.name, msg);
        markdown = `---\nfile: ${file.name}\nformat_fallback: raw\nformat_error: ${msg.replace(/\n/g, ' ').slice(0, 200)}\n---\n\n${rawText.replace(/\r\n?/g, '\n').trim()}\n`;
      }
    }
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

  // Write the result into the content-addressed cache so future uploads
  // of the same bytes skip transcription / LLM formatting entirely.
  await setCache(cacheKey, {
    markdown,
    format_path: formatPath,
    input_chars: rawText.length,
    output_chars: markdown.length,
  });

  return NextResponse.json({
    markdown,
    filename: file.name,
    generation_id: gen.id,
    format_path: formatPath,
    input_chars: rawText.length,
    output_chars: markdown.length,
    cached: false,
  });
}
