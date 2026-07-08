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
- 각 todo 에 due_bucket(기한 분류)을 반드시 지정합니다. **발화에 표현된 기한만 근거로** 다음 중 하나로 분류합니다:
  - overdue: 이미 지난 기한(예 "지난주까지였는데")
  - today: 오늘 안
  - this_week: 이번 주 안(예 "이번 주 금요일까지", "금요일까지")
  - this_month: 이번 달 안(예 "월말까지", "이달 안에")
  - later: 그 이후(다음 달 이상, 예 "다음 분기", "3월 15일")
  - none: 기한 표현이 전혀 없음. **기한 언급이 없으면 반드시 none 이며, 임의로 다른 bucket 을 추측하지 마세요.**
- due_date 는 발화에 **명시적 달력 날짜**(예 "3월 15일")가 나온 경우에만 YYYY-MM-DD 로 채우고, 없으면 null(추측 금지).
- 출력 언어는 전사록의 주 언어를 따릅니다(한국어 전사면 한국어, 영어면 영어).
- 화자 라벨(Speaker N 등)은 요약에 그대로 옮기지 말고, 필요하면 발화 맥락으로 자연스럽게 서술합니다.`;

// 정렬 가능한 기한 bucket. LLM 이 발화에 표현된 기한만 근거로 분류한다
// (자유 텍스트 `due` 는 언어·표현 제각각이라 코드로 시간순 비교 불가 → 이
// enum 으로 그룹핑/정렬한다). 기한 표현이 없으면 'none'(추측 금지).
const DUE_BUCKETS = ['overdue', 'today', 'this_week', 'this_month', 'later', 'none'] as const;
type DueBucket = (typeof DUE_BUCKETS)[number];

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
    .describe('기한 — 발화에 명시된 원문 텍스트. 표시용. 없으면 null.'),
  due_bucket: z
    .enum(DUE_BUCKETS)
    .describe(
      '기한 분류(정렬용). overdue=이미 지남, today=오늘, this_week=이번 주, this_month=이번 달, later=그 이후, none=기한 표현 없음(추측 금지). 발화에 표현된 기한만 근거로.',
    ),
  due_date: z
    .string()
    .nullable()
    .optional()
    .describe('달력 날짜(YYYY-MM-DD) — 발화에 명시적 날짜가 나온 경우만. 그룹 내부 정밀 정렬용. 없으면 null.'),
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

type Todo = {
  task: string;
  assignee?: string | null;
  due?: string | null;
  due_bucket?: DueBucket | null;
  due_date?: string | null;
};

// 그룹 렌더 순서 = 빠른 기한 우선. none(기한 미정)은 항상 맨 뒤.
const BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'this_week', 'this_month', 'later', 'none'];

// 그룹 헤더 라벨(한국어). 앱 기본 로케일(ko)에 맞춰 코드 생성 라벨은 한국어로
// 통일한다(기존 `## 회의 요약`/`## Todo` 하드코드 라벨과 동일 관행).
const BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: '기한 지남',
  today: '오늘',
  this_week: '이번 주',
  this_month: '이번 달',
  later: '이후',
  none: '기한 미정',
};

// 하나의 todo → `- {task} (담당: X · 기한: {due 원문})` bullet.
function renderTodoBullet(t: Todo): string {
  const meta: string[] = [];
  if (t.assignee?.trim()) meta.push(`담당: ${t.assignee.trim()}`);
  if (t.due?.trim()) meta.push(`기한: ${t.due.trim()}`);
  const suffix = meta.length ? ` (${meta.join(' · ')})` : '';
  return `- ${t.task.trim()}${suffix}`;
}

// 그룹 내부 정렬: due_date(YYYY-MM-DD)가 둘 다 있으면 오름차순, 아니면 원래
// (LLM) 순서 유지. Array.prototype.sort 는 안정 정렬이라 due_date 없는 항목은
// 상대 순서가 보존된다.
function sortWithinGroup(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const da = a.due_date?.trim();
    const db = b.due_date?.trim();
    if (da && db) return da.localeCompare(db);
    return 0;
  });
}

// 구조화된 결과 → 렌더 준비된 마크다운 블록. `## 회의 요약` + `## Todo`.
// Todo 는 기한 bucket 별 그룹(`### 라벨`)으로 묶고 빠른 기한 그룹을 위로
// 정렬한다. docx.ts 의 renderMarkdownBlock 이 `#{1,6}` heading / `-` bullet 을
// 인식하므로 `### 라벨` 은 preview·docx 양쪽에서 렌더된다.
function buildMarkdown(result: { summary: string; todos: Todo[] }): string {
  const parts: string[] = ['## 회의 요약', '', result.summary.trim(), '', '## Todo', ''];

  if (result.todos.length === 0) {
    parts.push('_도출된 액션 아이템이 없습니다._');
    parts.push('');
    return parts.join('\n');
  }

  // bucket 별로 그룹핑. bucket 이 비어 있는(구버전/누락) 항목은 none 취급.
  const byBucket = new Map<DueBucket, Todo[]>();
  for (const t of result.todos) {
    const bucket: DueBucket = t.due_bucket && BUCKET_ORDER.includes(t.due_bucket) ? t.due_bucket : 'none';
    const arr = byBucket.get(bucket);
    if (arr) arr.push(t);
    else byBucket.set(bucket, [t]);
  }

  // 엣지: 모든 todo 가 none(기한 표현 전무)이면 외로운 "기한 미정" 헤더를
  // 피하려고 그룹 헤더 없이 단일 flat 리스트로 폴백.
  const nonEmptyBuckets = BUCKET_ORDER.filter((b) => (byBucket.get(b)?.length ?? 0) > 0);
  if (nonEmptyBuckets.length === 1 && nonEmptyBuckets[0] === 'none') {
    for (const t of result.todos) parts.push(renderTodoBullet(t));
    parts.push('');
    return parts.join('\n');
  }

  // 빠른 기한 우선 그룹 렌더. 빈 bucket 은 생략, none 은 맨 뒤.
  for (const bucket of nonEmptyBuckets) {
    const todos = byBucket.get(bucket)!;
    parts.push(`### ${BUCKET_LABEL[bucket]}`, '');
    for (const t of sortWithinGroup(todos)) parts.push(renderTodoBullet(t));
    parts.push('');
  }
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
