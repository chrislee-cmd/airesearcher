import { NextResponse } from 'next/server';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { classifyFile, extractDocText } from '@/lib/file-extract';

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
const SYSTEM = `당신은 리서치 자료 정리 전문가입니다. 업로드된 여러 자료(인터뷰 전사·노트·메모 등 양식이 제각각일 수 있음)를 읽어, 다음 **표준 보고서 양식 Markdown**으로 1차 정리합니다.

엄격한 출력 규칙:
- 출력은 **순수 Markdown 한 개만**. 코드펜스, 머리말, 설명 금지.
- 섹션 헤더는 **반드시 아래 순서·표기 그대로** 사용. 빠뜨리지 말 것.
- 입력 자료에 명시적으로 없는 사실/숫자/인용을 만들지 말 것. 자료가 부족한 섹션은 "자료 미흡" 한 줄로 표기.
- 모든 정성 인용은 \`> "원문 그대로"\` blockquote + 다음 줄에 \`— 화자/세그먼트 (출처파일명)\` 표기.

# 스키마

\`\`\`
---
title: <리포트 제목>
subtitle: <한 줄 부제>
period: <자료 수집 기간 또는 추정>
sample: <응답자 수·구성 요약>
sources: <파일 수>
---

# Cover

(2~3줄로 리포트의 한 단락 요약)

## Methodology

- 자료 종류 / 수집 방법
- 응답자 구성
- 분석 절차

## Executive Summary

3~5개의 핵심 인사이트를 bullet로. 각 bullet은 한 문장 헤드라인 + 한두 문장 서포트.

## Persona

응답자 그룹 또는 페르소나. 그룹별 H3(\`### …\`) 섹션 + 특징 bullet.

## Chapter I: <테마 제목>

### Headline

한 문장. 슬라이드 표지처럼 강하게. (예: "민감성 피부 응답자는 '자극 없는 성분'을 다른 모든 속성보다 우선한다")

### Findings

3~6개 bullet. 각 bullet은 그 자체로 한 슬라이드의 인사이트로 쓸 수 있을 만큼 자기완결적. 추상 표현 대신 구체 숫자·세그먼트·비교 포함.

### Verbatim

복수의 인용 가능. 각 인용은 다음 두 줄:

> "원문 인용 그대로"
> — 화자/세그먼트 (파일명)

### Quantitative

수치 신호가 있으면 다음 형식의 표로:

| 항목 | 값 | 비고 |
|---|---|---|
| AM 사용률 | 72% | n=120 |
| PM 사용률 | 86% | n=120 |

수치가 없으면 이 섹션 자체를 생략하지 말고 \`(자료 미흡)\` 한 줄.

### Implication

1~3개 bullet, 액션 동사로 시작 (예: "성분 우선 메시지로 광고 카피 재정렬", "민감성 세그먼트에 별도 SKU 라인업 검토").

## Chapter II: ...

(같은 5-서브섹션 패턴 반복. 자료 양에 따라 3~6개 챕터 권장.)

## Recommendations

실행 가능한 권장 액션. 우선순위 순.

## Appendix

- 출처 파일 목록 (파일명 그대로)
- 분석 한계 / caveat
\`\`\`

한국어로 작성. 헤더 표기(\`# Cover\`, \`## Methodology\` 등)는 위 스키마와 글자 그대로 일치해야 합니다.`;

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
    system: SYSTEM,
    prompt: `다음은 업로드된 ${sources.length}개 자료입니다. 표준 보고서 양식 Markdown으로 정리하세요.\n\n${corpus}`,
    temperature: 0.2,
    maxOutputTokens: 64000,
  });

  return result.toTextStreamResponse();
}
