import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { fileExtractionSchema } from '@/lib/interview-schema';

export const maxDuration = 300;

const Body = z.object({
  filename: z.string().min(1),
  markdown: z.string().min(1),
});

const SYSTEM = `당신은 인터뷰 분석가입니다. 단일 인터뷰 마크다운(질문은 보통 \`## Q.\` 또는 진행자 발화로 표기)을 받아 다음을 수행하세요:

1) **모든 질문 추출 (question)**
   - 진행자(M / 진행자 / 면접관 / Moderator / Interviewer)가 던진 모든 질문을 빠짐없이 정리하세요.
   - 너무 짧은 후속 확인성 발화("그래요?", "맞나요?")는 제외.
   - 결과는 보통 10~40개 사이입니다. 1~2개로 줄이지 마세요.
   - 인터뷰 진행 순서를 따라 정렬.

2) **VOC 인용구(voc) — 핵심**
   - 그 질문에 대한 응답자의 답변에서 **가장 잘 대표하는 부분**을 발췌해서 \`voc\` 필드에 넣으세요.
   - **반드시 입력된 마크다운에 그대로 존재하는 응답자의 발화**여야 합니다. 번역·요약·재서술·문장 합치기 금지.
   - **길이는 한 문장에서 한 문단까지 자유롭게.** 한 문장으로 충분하면 한 문장, 핵심 흐름이 길면 여러 문장 발췌.
   - 큰따옴표/작은따옴표는 포함하지 마세요 (시스템이 따로 감쌉니다).
   - 본문에서 그대로 복사한 연속된 텍스트만 사용. 떨어진 문장 두 개를 합치는 것 금지 (붙어있는 문장은 OK).
   - 응답자가 직접 발화한 부분이 마크다운에 명확히 없거나 의미 있는 답이 없으면 빈 문자열.

3) 한국어로 작성. 출력은 정의된 JSON 스키마만, 그 외 텍스트 금지.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { filename, markdown } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: fileExtractionSchema,
    system: SYSTEM,
    prompt: `파일명: ${filename}\n\n인터뷰 마크다운:\n\n${markdown.slice(0, 200000)}`,
    temperature: 0.1,
  });

  return result.toTextStreamResponse();
}
