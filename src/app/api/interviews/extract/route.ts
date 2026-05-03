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

1) **모든 질문 추출**
   - 진행자(M / 진행자 / 면접관 / Moderator / Interviewer)가 던진 모든 질문을 빠짐없이 정리하세요.
   - 너무 짧은 후속 확인성 발화("그래요?", "맞나요?")는 제외.
   - 결과는 보통 10~40개 사이입니다. 1~2개로 줄이지 마세요.
   - 인터뷰 진행 순서를 따라 정렬.

2) **응답 발췌(summary)** — 요약이 아니라 **정제된 발췌**입니다
   - 해당 질문에 대한 응답자의 실제 답변을 본문에서 발췌하세요. 요약·해석·재서술·평가 금지.
   - 응답자의 원문 표현·어휘·말투를 그대로 유지합니다.
   - 단순 disfluency만 정제: "음·어·그·뭐·이제" 같은 의미 없는 추임새, 명백한 반복, 중간에 끊긴 단어, 녹음 잡음("(웃음)" 등) 제거.
   - 응답이 길면 핵심 흐름이 살아있도록 1~3문장 정도까지 이어붙여도 좋습니다. 짧으면 그대로 짧게 둡니다.
   - 새 문장을 만들지 말고, 본문에 등장한 표현만 사용하세요. 가벼운 어미 다듬기(예: 끊긴 "근데...."를 마침표로 종결)는 허용하지만 의미 변경은 금지.
   - 응답이 없거나 의미 있는 답이 없으면 빈 문자열.

3) **VOC 인용구(verbatim) — 중요**
   - summary 안에서 **가장 인상적인 한 줄**을 골라 \`verbatim\` 에 그대로 복사하세요. (summary는 여러 문장 발췌, verbatim은 그 안의 핵심 한 줄)
   - 반드시 입력된 마크다운에 **그대로 존재하는 응답자 발화**여야 합니다.
   - 번역·요약·문장 합치기·정규화 금지. 띄어쓰기와 구두점도 원문 그대로.
   - 큰따옴표/작은따옴표는 포함하지 마세요 (시스템이 따로 감쌉니다).
   - 응답자가 직접 발화한 부분이 마크다운에 명확히 없다면 빈 문자열.

4) 한국어로 작성. 출력은 정의된 JSON 스키마만, 그 외 텍스트 금지. 한 항목씩 순서대로 emit하세요.`;

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
