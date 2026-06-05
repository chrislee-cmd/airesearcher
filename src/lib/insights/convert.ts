import OpenAI from 'openai';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { classifyFile, extractDocText } from '@/lib/file-extract';
import { tryRegexMarkdown, tryMarkdownPassthrough } from '@/lib/markdown-format';

export type ConvertFormatPath = 'regex' | 'passthrough' | 'llm' | 'raw';

export type ConvertResult = {
  markdown: string;
  format_path: ConvertFormatPath;
  input_chars: number;
  output_chars: number;
};

// Mirror of the legacy `/api/interviews/convert` formatter system prompt.
// Insights extraction works on the *content* of the markdown, not its
// surface form, so any reasonable speaker-labeled markdown is fine here.
const SYSTEM = `당신은 인터뷰 노트 정리자입니다. 원문 인터뷰 텍스트를 받아 다음 규칙으로 한국어 마크다운으로 정리하세요:

1) 진행자 질문은 \`## Q. <질문>\` 형식으로 헤더로 만듭니다.
2) 응답자 발화는 헤더 아래 본문 단락으로 그대로 옮깁니다 (요약/번역 금지).
3) 화자 식별이 가능한 부분은 그대로 보존, 추가 해설 금지.
4) 시작에 YAML frontmatter (\`---\nfile: <filename>\n---\`) 를 한 번 붙입니다.
5) 출력은 마크다운만, 그 외 설명 텍스트 금지.`;

/**
 * Convert a single uploaded File (any supported MIME) into a clean
 * structured markdown string. Reuses the same 4-path strategy as the
 * legacy `/api/interviews/convert` route so insights uploads see the same
 * recall guarantees:
 *
 *   1. **regex** — speaker-labeled transcript (M:/R:, 진행자:/응답자:).
 *   2. **passthrough** — already-structured text (headers, lists,
 *      paragraph breaks, .md ext, or input > 25k chars).
 *   3. **llm** — unstructured Whisper output / free-form notes.
 *   4. **raw** — LLM failed (rate limit, missing key); we keep the raw
 *      text rather than throwing so the extract step still has data.
 *
 * Throws on unsupported file type or when extraction yields empty text —
 * the route handler catches and records the file as failed in
 * `insights_jobs.failure_reason`.
 */
export async function convertFileToMarkdown(file: File): Promise<ConvertResult> {
  const kind = classifyFile(file);
  if (kind === 'unsupported') {
    throw new Error(`unsupported_file_type: ${file.type || file.name}`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let rawText: string;
  if (kind === 'audio' || kind === 'video') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('missing_openai_key');
    const openai = new OpenAI({ apiKey });
    const audioFile = new File([buffer], file.name, {
      type: file.type || 'application/octet-stream',
    });
    const tx = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'gpt-4o-mini-transcribe',
      response_format: 'text',
    });
    rawText = typeof tx === 'string' ? tx : (tx as { text?: string }).text ?? '';
  } else {
    const docFile = new File([buffer], file.name, {
      type: file.type || 'application/octet-stream',
    });
    rawText = await extractDocText(docFile);
  }

  if (!rawText.trim()) {
    throw new Error('no_text_extracted');
  }

  const regexMd = tryRegexMarkdown(rawText, file.name);
  if (regexMd) {
    return {
      markdown: regexMd,
      format_path: 'regex',
      input_chars: rawText.length,
      output_chars: regexMd.length,
    };
  }

  const passthroughMd = tryMarkdownPassthrough(rawText, file.name);
  if (passthroughMd) {
    return {
      markdown: passthroughMd,
      format_path: 'passthrough',
      input_chars: rawText.length,
      output_chars: passthroughMd.length,
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    const fallback = `---\nfile: ${file.name}\n---\n\n${rawText.replace(/\r\n?/g, '\n').trim()}\n`;
    return {
      markdown: fallback,
      format_path: 'raw',
      input_chars: rawText.length,
      output_chars: fallback.length,
    };
  }

  try {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    const result = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: SYSTEM,
      prompt: `파일명: ${file.name}\n\n원문 인터뷰 텍스트:\n\n${rawText}`,
      temperature: 0.2,
      maxOutputTokens: 16384,
    });
    const md = result.text.trim() || rawText;
    return {
      markdown: md,
      format_path: 'llm',
      input_chars: rawText.length,
      output_chars: md.length,
    };
  } catch (e) {
    // Same fallback as legacy: keep the raw text rather than losing the
    // upload entirely. The extractor downstream can still recover quotes
    // from raw text — it's just less clean.
    const msg = e instanceof Error ? e.message : 'format_failed';
    const fallback = `---\nfile: ${file.name}\nformat_fallback: raw\nformat_error: ${msg.replace(/\n/g, ' ').slice(0, 200)}\n---\n\n${rawText.replace(/\r\n?/g, '\n').trim()}\n`;
    return {
      markdown: fallback,
      format_path: 'raw',
      input_chars: rawText.length,
      output_chars: fallback.length,
    };
  }
}
