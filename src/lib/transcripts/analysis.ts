import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { env } from '@/env';
import { ZERO_RETENTION } from '../llm/config';

// research 모드(mode='research') 전사 결과의 LLM 후처리 패스.
//
// 전사 완료 후 확보된 라벨링 마크다운을 입력받아 전사 풀뷰 V2 detail(state 05)
// 우측 rail 에 그릴 (1) 전체 요약(summary) 과 (2) Key themes(반복 주제 + 등장
// 빈도 count)를 LLM(claude-sonnet)으로 생성한다. meeting-summary.ts 와 동일한
// **발화 근거 기반**(환각 금지) · **no-op-on-failure** 계약: 실패/근거 부족/키
// 부재 시 result 는 null 이고, 저장부는 transcript_jobs.analysis 를 건드리지
// 않는다(전사 본문·다른 컬럼 무영향, UI 는 '생성' CTA 스텁으로 폴백).
//
// 저장 shape (jsonb):
//   { "summary": string, "themes": [ { "label": string, "count": number } ] }

const MIN_TRANSCRIPT_CHARS = 200;

// i18n-allow-korean -- 서버측 LLM 시스템 프롬프트(비-UI, meeting-summary.ts 동형)
const ANALYSIS_SYSTEM = `당신은 리서치 인터뷰 전사록 분석 도우미입니다. 전사록을 입력받아 두 가지를 만듭니다.

1. summary — 응답자(참가자)의 핵심 발언과 인사이트를 2~4문장으로 요약. 진행자의 질문이 아니라 참가자가 실제로 드러낸 니즈·불만·행동·감정에 초점.
2. themes — 전사에서 반복적으로 드러난 주제(Key theme) 목록. 각 theme 은 짧은 라벨(2~4단어)과 그 주제가 전사에서 언급/암시된 대략적 횟수(count, 1 이상 정수)를 가집니다.

엄격한 규칙:
- 반드시 전사 내용에 **근거**한 것만 작성합니다. 전사에 없는 주제·인사이트를 지어내지 마세요(환각 금지).
- themes 는 실제 전사에서 반복되거나 강조된 주제만. 근거가 약하면 넣지 마세요. 보통 2~5개가 적당하며, 억지로 개수를 채우지 않습니다. 반복 주제가 전혀 없으면 빈 배열을 반환합니다.
- 각 theme 의 count 는 그 주제가 전사에서 언급/암시된 대략적 횟수입니다(정확한 카운트가 아니어도 되지만 전사 근거에 비례해야 하며 최소 1).
- 출력 언어는 전사록의 주 언어를 따릅니다(한국어 전사면 한국어, 영어면 영어).
- 화자 라벨(Speaker N 등)은 요약/라벨에 그대로 옮기지 말고, 필요하면 발화 맥락으로 자연스럽게 서술합니다.`;

const themeSchema = z.object({
  label: z
    .string()
    // i18n-allow-korean -- LLM 스키마 설명(서버, 비-UI)
    .describe('주제 라벨(2~4단어). 전사에 근거한 반복 주제.'),
  count: z
    .number()
    .int()
    .min(1)
    // i18n-allow-korean -- LLM 스키마 설명(서버, 비-UI)
    .describe('그 주제가 전사에서 언급/암시된 대략적 횟수(최소 1).'),
});

const analysisSchema = z.object({
  // i18n-allow-korean -- LLM 스키마 설명(서버, 비-UI)
  summary: z.string().describe('응답자 핵심 인사이트 2~4문장 요약.'),
  themes: z
    .array(themeSchema)
    // i18n-allow-korean -- LLM 스키마 설명(서버, 비-UI)
    .describe('전사 근거 반복 주제 목록. 없으면 빈 배열.'),
});

// UI(detail rail) 가 소비하는 저장 shape. jsonb 컬럼 값과 route 응답이 공유.
export type TranscriptAnalysis = {
  summary: string;
  themes: { label: string; count: number }[];
};

export type TranscriptAnalysisAudit = {
  skipped: boolean;
  reason?: 'no_api_key' | 'too_short' | 'llm_failed';
  themes_count: number;
  summary_chars: number;
};

export type TranscriptAnalysisResult = {
  analysis: TranscriptAnalysis | null;
  audit: TranscriptAnalysisAudit;
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

// 임의의 저장값을 검증된 TranscriptAnalysis 로 정규화. jsonb 컬럼에서 읽은
// 값이 스키마와 어긋나면(구버전/수기 편집) null 로 떨궈 UI 가 '생성' 스텁으로
// 폴백하게 한다.
export function coerceAnalysis(raw: unknown): TranscriptAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!summary) return null;
  const themesRaw = Array.isArray(obj.themes) ? obj.themes : [];
  const themes = themesRaw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      label: typeof t.label === 'string' ? t.label.trim() : '',
      count:
        typeof t.count === 'number' && Number.isFinite(t.count)
          ? Math.max(1, Math.round(t.count))
          : 1,
    }))
    .filter((t) => t.label.length > 0);
  return { summary, themes };
}

/**
 * research 모드 후처리 — 전사 마크다운에서 AI 요약 + Key themes 를 생성해
 * 구조화 객체로 반환한다. 실패/근거 부족/키 부재 시 analysis 는 null 이고,
 * 호출부는 analysis 컬럼을 건드리지 않는다(전사 본문 유지).
 */
export async function analyzeTranscript(
  transcriptMarkdown: string,
  filename: string,
): Promise<TranscriptAnalysisResult> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      analysis: null,
      audit: { skipped: true, reason: 'no_api_key', themes_count: 0, summary_chars: 0 },
    };
  }

  const transcript = stripFrontMatter(transcriptMarkdown);
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    return {
      analysis: null,
      audit: { skipped: true, reason: 'too_short', themes_count: 0, summary_chars: 0 },
    };
  }

  const anthropic = createAnthropic({ apiKey });
  // 사용자 프롬프트 = 헤더(파일 컨텍스트) + 전사 본문 + 지시문. Korean 리터럴은
  // interpolation 뒤(TemplateTail)에 오면 지시자 억제가 안 되므로 지시문을 별
  // 상수로 분리해 각각 마킹한다(서버측 LLM 프롬프트, 비-UI).
  // i18n-allow-korean -- 서버측 LLM 사용자 프롬프트 헤더(비-UI)
  const promptHead = `아래는 리서치 인터뷰 전사록입니다(파일: ${filename}).`;
  // i18n-allow-korean -- 서버측 LLM 사용자 프롬프트 지시문(비-UI, meeting-summary.ts 동형)
  const promptTail = '위 전사 내용에 근거해서 요약(summary)과 반복 주제(themes)를 만들어 주세요.\n전사에 없는 내용은 절대 지어내지 마세요.';
  const prompt = `${promptHead}\n\n${transcript}\n\n${promptTail}`;

  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: analysisSchema,
      system: ANALYSIS_SYSTEM,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 2048,
      providerOptions: ZERO_RETENTION,
    });
    const obj = result.object;
    const summary = obj.summary?.trim();
    if (!summary) {
      return {
        analysis: null,
        audit: { skipped: true, reason: 'llm_failed', themes_count: 0, summary_chars: 0 },
      };
    }
    const themes = obj.themes
      .map((t) => ({ label: t.label.trim(), count: Math.max(1, Math.round(t.count)) }))
      .filter((t) => t.label.length > 0);
    return {
      analysis: { summary, themes },
      audit: {
        skipped: false,
        themes_count: themes.length,
        summary_chars: summary.length,
      },
    };
  } catch (e) {
    console.warn('[transcripts/analysis] generation failed', e);
    return {
      analysis: null,
      audit: { skipped: true, reason: 'llm_failed', themes_count: 0, summary_chars: 0 },
    };
  }
}
