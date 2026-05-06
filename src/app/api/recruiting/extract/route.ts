import { NextResponse } from 'next/server';
import { streamObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { classifyFile, extractDocText } from '@/lib/file-extract';
import { recruitingBriefSchema } from '@/lib/recruiting-schema';

export const maxDuration = 300;

const MAX_FILES = 10;
const MAX_BYTES_PER_FILE = 25 * 1024 * 1024;
const MAX_TOTAL_INPUT_CHARS = 200_000;

const SYSTEM = `당신은 정성/정량 리서치 모집 전문가입니다. 업로드된 RFP·제안서·이메일·표 등 자료를 읽고, 다음 두 가지를 구조화하여 추출하세요.

1) **대상자 모집 조건 (criteria)**
   - 인구통계(연령, 성별, 거주지), 직업/소득, 사용/구매 경험, 행태/태도, 보유 제품, 의사결정 권한, 디지털 활용도 등을 **항목별로 잘게 쪼개서** 추출.
   - 예: "30~40대 워킹맘"이 아니라 → ["연령 30-49", "성별 여성", "자녀 있음 (미취학 또는 초등)", "직업 풀타임/파트타임 근무 중"] 처럼 4개 row.
   - 각 항목은 \`category\`, \`label\`(짧게), \`detail\`(한 문장 설명), \`required\`(필수 여부)를 채울 것.
   - 자료에 명시되지 않은 조건은 만들지 말 것.

2) **조사 일정 (schedule)**
   - 단계별로 분리. 예: "스크리닝 모집", "본 인터뷰", "녹취 정리", "리포팅", "보상 지급".
   - 날짜는 \`YYYY-MM-DD\` 형식. 명시되지 않은 날짜는 null.
   - 단일일은 startDate=endDate.
   - 일정이 자료에 전혀 없으면 빈 배열.

한국어로 작성. 결과는 JSON 스키마만, 그 외 텍스트 금지.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const formData = await request.formData();
  const entries = formData.getAll('files');
  const files: File[] = entries.filter((e): e is File => e instanceof File);
  const pasted = (formData.get('pasted') as string | null) ?? '';

  if (files.length === 0 && !pasted.trim()) {
    return NextResponse.json({ error: 'no_input' }, { status: 400 });
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
    if (kind === 'audio' || kind === 'video' || kind === 'unsupported') {
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
  if (pasted.trim()) {
    sources.push({ name: '(붙여넣은 텍스트)', text: pasted });
  }
  if (sources.length === 0) {
    return NextResponse.json({ error: 'no_text_extracted' }, { status: 422 });
  }

  const perFileBudget = Math.max(
    6_000,
    Math.floor(MAX_TOTAL_INPUT_CHARS / sources.length),
  );
  const corpus = sources
    .map((s) => {
      const body = s.text.length > perFileBudget
        ? `${s.text.slice(0, perFileBudget)}\n\n[...truncated ${s.text.length - perFileBudget} chars]`
        : s.text;
      return `===== SOURCE: ${s.name} =====\n${body}`;
    })
    .join('\n\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'missing_anthropic_key' }, { status: 500 });
  const anthropic = createAnthropic({ apiKey });

  const result = streamObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: recruitingBriefSchema,
    system: SYSTEM,
    prompt: `다음은 업로드된 ${sources.length}개 자료입니다. 모집 조건과 일정을 추출하세요.\n\n${corpus}`,
    temperature: 0.1,
  });

  return result.toTextStreamResponse();
}
