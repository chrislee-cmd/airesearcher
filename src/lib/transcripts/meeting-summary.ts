import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '@/env';
import { ZERO_RETENTION } from '../llm/config';

// 회의록 모드(mode='meeting') 전용 후처리 패스.
//
// 전사 완료 후 확보된 마크다운을 입력받아 (1) 전체 내용 요약, (2) Todo-list
// (액션 아이템)를 LLM(claude-sonnet)으로 생성한다. 핵심 원칙은 **발화 근거
// 기반** — 전사에 실제로 나온 논의/결정/액션만 반영하고 없는 항목을 지어내지
// 않는다(환각 금지). 담당자/기한이 발화에 명시돼 있으면 병기, 없으면 task 만.
//
// 반환은 렌더 준비된 마크다운 블록(`## 회의 요약` + `## Todo`). 저장은 별도
// 컬럼(meeting_summary)에 하고, 전사 본문(markdown/clean_markdown)은 절대
// 건드리지 않는다 — 실패 시 markdown NULL 로 남고 preview/download 는 전사
// 본문만 정상 렌더(요약만 skip). cleanup.ts 와 동일한 no-op-on-failure 계약.

const MIN_TRANSCRIPT_CHARS = 200;

const MEETING_SUMMARY_SYSTEM = `당신은 회의록 요약 도우미입니다. 회의 전사록을 입력받아 두 가지를 만듭니다.

1. summary — 회의의 핵심 논의와 결정 사항을 3~6문장으로 요약.
2. todos — 회의에서 도출된 액션 아이템(할 일) 목록.

엄격한 규칙:
- 반드시 전사 내용에 **근거**한 것만 작성합니다. 전사에 없는 논의/결정/액션을 지어내지 마세요(환각 금지).
- 액션 아이템은 실제 발화에서 "~하기로 함", "~가 하겠다", "다음까지 ~" 처럼 명확히 도출된 것만 포함합니다. 애매하면 넣지 마세요.
- 액션 아이템이 하나도 없으면 todos 를 빈 배열로 반환합니다(억지로 만들지 말 것).
- 각 todo 의 담당자(assignee)/기한(due)은 발화에 명시된 경우에만 채우고, 없으면 비웁니다(추측 금지).
- 출력 언어는 전사록의 주 언어를 따릅니다(한국어 전사면 한국어, 영어면 영어).
- 화자 라벨(Speaker N 등)은 요약에 그대로 옮기지 말고, 필요하면 발화 맥락으로 자연스럽게 서술합니다.`;

const todoSchema = z.object({
  task: z.string().describe('할 일 한 줄. 전사에 근거한 액션만.'),
  assignee: z
    .string()
    .nullable()
    .optional()
    .describe('담당자 — 발화에 명시된 경우만. 없으면 null.'),
  due: z
    .string()
    .nullable()
    .optional()
    .describe('기한 — 발화에 명시된 경우만. 없으면 null.'),
});

const meetingSummarySchema = z.object({
  summary: z.string().describe('회의 핵심 논의·결정 3~6문장 요약.'),
  todos: z
    .array(todoSchema)
    .describe('전사 근거 액션 아이템. 없으면 빈 배열.'),
});

export type MeetingSummaryAudit = {
  skipped: boolean;
  reason?: 'no_api_key' | 'too_short' | 'llm_failed';
  todos_count: number;
  summary_chars: number;
};

export type MeetingSummaryResult = {
  markdown: string | null;
  audit: MeetingSummaryAudit;
};

// 전사 마크다운에서 YAML front-matter 를 걷어내고 발화 본문만 추출.
function stripFrontMatter(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return markdown.trim();
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      i++;
      break;
    }
  }
  return lines.slice(i).join('\n').trim();
}

// 구조화된 결과 → 렌더 준비된 마크다운 블록. `## 회의 요약` + `## Todo`.
// docx.ts 의 renderMarkdownBlock 이 `##` heading / `-` bullet 을 인식한다.
function buildMarkdown(result: {
  summary: string;
  todos: Array<{ task: string; assignee?: string | null; due?: string | null }>;
}): string {
  const parts: string[] = ['## 회의 요약', '', result.summary.trim(), '', '## Todo', ''];
  if (result.todos.length === 0) {
    parts.push('_도출된 액션 아이템이 없습니다._');
  } else {
    for (const t of result.todos) {
      const meta: string[] = [];
      if (t.assignee?.trim()) meta.push(`담당: ${t.assignee.trim()}`);
      if (t.due?.trim()) meta.push(`기한: ${t.due.trim()}`);
      const suffix = meta.length ? ` (${meta.join(' · ')})` : '';
      parts.push(`- ${t.task.trim()}${suffix}`);
    }
  }
  parts.push('');
  return parts.join('\n');
}

/**
 * 회의록 모드 후처리 — 전사 마크다운에서 전체 요약 + Todo-list 를 생성해
 * 렌더 준비된 마크다운 블록으로 반환한다. 실패/근거 부족/키 부재 시 markdown
 * 은 null 이고, 호출부는 meeting_summary 컬럼을 NULL 로 남긴다(전사 본문 유지).
 */
export async function summarizeMeeting(
  transcriptMarkdown: string,
  filename: string,
): Promise<MeetingSummaryResult> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { markdown: null, audit: { skipped: true, reason: 'no_api_key', todos_count: 0, summary_chars: 0 } };
  }

  const transcript = stripFrontMatter(transcriptMarkdown);
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return { markdown: null, audit: { skipped: true, reason: 'too_short', todos_count: 0, summary_chars: 0 } };
  }

  const anthropic = createAnthropic({ apiKey });
  const prompt = `아래는 회의 전사록입니다(파일: ${filename}).

${transcript}

위 전사 내용에 근거해서 회의 요약(summary)과 액션 아이템(todos)을 만들어 주세요.
전사에 없는 내용은 절대 지어내지 마세요.`;

  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: meetingSummarySchema,
      system: MEETING_SUMMARY_SYSTEM,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 2048,
      providerOptions: ZERO_RETENTION,
    });
    const obj = result.object;
    if (!obj.summary?.trim()) {
      return { markdown: null, audit: { skipped: true, reason: 'llm_failed', todos_count: 0, summary_chars: 0 } };
    }
    return {
      markdown: buildMarkdown(obj),
      audit: {
        skipped: false,
        todos_count: obj.todos.length,
        summary_chars: obj.summary.trim().length,
      },
    };
  } catch (e) {
    console.warn('[transcripts/meeting-summary] generation failed', e);
    return { markdown: null, audit: { skipped: true, reason: 'llm_failed', todos_count: 0, summary_chars: 0 } };
  }
}
