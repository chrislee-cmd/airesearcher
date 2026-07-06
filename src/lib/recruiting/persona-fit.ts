import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generateObject } from 'ai';
import type { AnthropicProvider } from '@ai-sdk/anthropic';
import { ZERO_RETENTION } from '@/lib/llm/config';
import { ISOLATION_NOTICE, wrapUserInput } from '@/lib/llm/sanitize';
import type { FormColumn, FormResponseRow } from '@/lib/google-forms';
import { isPiiColumn } from '@/lib/recruiting-pii';
import type { RecruitingBrief } from '@/lib/recruiting-schema';

// ─── 판단 스키마 ──────────────────────────────────────────────────────────
//
// 응답자당 종합 판단. fit 은 0-100 점수가 아니라 3단계 — 점수는 정밀성 착시를
// 주지만 근거의 해석 가능성이 떨어진다는 스펙 결정. 폼에 참여자 조건이 없으면
// fit / fit_reason 은 null (demographics 추출만).
export type PersonaFit = 'high' | 'medium' | 'low';

export const respondentJudgmentSchema = z.object({
  ref: z
    .string()
    .describe('입력에서 이 응답자에 부여된 참조 라벨(R1, R2 …). 그대로 반환.'),
  gender: z
    .enum(['여성', '남성'])
    .nullable()
    .describe('응답에서 추출한 성별. 불명확하면 null.'),
  age_group: z
    .string()
    .nullable()
    .describe('연령대. "20대"·"30대" 형식. 불명확하면 null.'),
  region: z
    .string()
    .nullable()
    .describe('거주지 광역 단위. "서울"·"경기" 등. 불명확하면 null.'),
  fit: z
    .enum(['high', 'medium', 'low'])
    .nullable()
    .describe('참여자 조건 대비 부합도 3단계. 조건이 제공되지 않았으면 null.'),
  fit_reason: z
    .string()
    .nullable()
    .describe(
      '부합/불합 근거 1-2문장. 조건 항목과 실제 응답 인용 기반. 임의 추론 금지. 조건 없으면 null.',
    ),
  flags: z
    .array(z.string())
    .describe(
      '불성실 응답 의심 태그(중복/한글자/모순 답변 등). 없으면 빈 배열.',
    ),
});

export const judgmentBatchSchema = z.object({
  judgments: z.array(respondentJudgmentSchema),
});

export type RespondentJudgment = z.infer<typeof respondentJudgmentSchema>;

// 응답자당 반환/저장되는 판단 (ref 는 내부 매핑용이라 제외, response_key 로 대체).
export type ResponseJudgment = {
  response_key: string;
  gender: string | null;
  age_group: string | null;
  region: string | null;
  fit: PersonaFit | null;
  fit_reason: string | null;
  flags: string[];
};

// ─── response_key — 응답 row 안정 식별자 ───────────────────────────────────
//
// Google Forms API 의 responseId 는 제출당 안정적으로 유지되는 id 라 그대로
// 캐시 키로 쓴다(실측: getFormResponses 가 매핑하는 raw.responseId 는 항상 존재).
// 방어적으로, 혹시라도 responseId 가 비면 제출시각 + 정렬된 답변 내용 해시로
// 폴백 — 같은 응답이면 같은 키가 나오도록.
export function deriveResponseKey(row: FormResponseRow): string {
  if (row.responseId) return row.responseId;
  const canonical = JSON.stringify({
    t: row.createTime ?? row.lastSubmittedTime ?? '',
    a: Object.entries(row.answers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([q, v]) => `${q}=${v}`),
  });
  return `h:${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}

// ─── criteria_hash — 조건 변경 감지 ────────────────────────────────────────
//
// 폼의 참여자 조건(criteria)을 정규화해 안정 해시로. 조건이 수정되면 해시가
// 바뀌어 라우트가 stale 캐시를 재판단 대상으로 취급한다. 조건이 없는(폼에
// 참여자 조건 미설정) 경우엔 sentinel 을 써서, 조건이 나중에 추가되면 그때
// 해시가 달라지도록 한다.
export const EMPTY_CRITERIA_HASH = 'nocriteria';

export function criteriaHash(criteria: RecruitingBrief['criteria'] | null): string {
  if (!criteria || criteria.length === 0) return EMPTY_CRITERIA_HASH;
  const canonical = JSON.stringify(
    criteria.map((c) => ({
      category: c.category,
      label: c.label,
      detail: c.detail,
      required: c.required,
    })),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// ─── 프롬프트 빌드 ────────────────────────────────────────────────────────

const MAX_BATCH = 20;

function criteriaBlock(criteria: RecruitingBrief['criteria'] | null): string {
  if (!criteria || criteria.length === 0) {
    return '(이 폼에는 참여자 조건이 설정되지 않았습니다. fit / fit_reason 은 null 로 두고, 인구통계 추출과 flags 만 판단하세요.)';
  }
  return criteria
    .map(
      (c, i) =>
        `${i + 1}. [${c.required ? '필수' : '우대'}] ${c.category} · ${c.label}: ${c.detail}`,
    )
    .join('\n');
}

// 한 응답자를 "질문: 답변" 블록으로. PII 컬럼(이름/전화)은 모델이 판단
// 컨텍스트로 볼 수 있게 전달하되, [PII·출력금지] 라벨로 절대 인용/출력하지
// 않도록 명시한다.
function respondentBlock(
  ref: string,
  row: FormResponseRow,
  columns: FormColumn[],
): string {
  const lines = columns
    .map((col) => {
      const val = row.answers[col.questionId];
      if (!val) return null;
      const pii = isPiiColumn(col.title);
      const label = pii ? `[PII·출력금지] ${col.title}` : col.title;
      return `- ${label}: ${val}`;
    })
    .filter(Boolean)
    .join('\n');
  return `### ${ref}\n${lines || '- (응답 없음)'}`;
}

function buildPrompt(
  criteria: RecruitingBrief['criteria'] | null,
  columns: FormColumn[],
  batch: { ref: string; row: FormResponseRow }[],
): string {
  const respondents = batch
    .map(({ ref, row }) => respondentBlock(ref, row, columns))
    .join('\n\n');
  const body = `## 참여자 조건(페르소나)
${criteriaBlock(criteria)}

## 응답자 (${batch.length}명)
${respondents}`;
  return wrapUserInput(body, 'recruiting_responses');
}

const SYSTEM = `당신은 정량 리서치 응답자 스크리너입니다. 각 응답자의 모든 응답을 읽고, 제시된 참여자 조건(페르소나) 대비 부합도를 종합 판단하세요.

규칙:
- 각 응답자마다: gender / age_group / region 을 응답에서 추출하고, fit(high/medium/low) + fit_reason 을 판단합니다.
- gender: "여성" 또는 "남성" 만. 응답에 근거가 없으면 null.
- age_group: "20대"·"30대"·"40대" 형식. 연령/생년 응답에서 유추. 근거 없으면 null.
- region: 거주지 응답의 광역 단위("서울"·"경기"·"부산" 등). 근거 없으면 null.
- fit 은 3단계로만. high = 필수 조건을 모두 충족 + 우대 조건도 상당수, medium = 필수는 대체로 충족하나 일부 미확인/애매, low = 필수 조건 불충족 또는 명백히 대상 아님.
- fit_reason: 1-2문장. 반드시 **조건 항목과 실제 응답 내용**을 근거로. 응답에 없는 사실을 지어내지 마세요(임의 추론 금지). 조건과 응답을 짧게 인용.
- 참여자 조건이 제공되지 않은 경우: fit 과 fit_reason 은 null, 인구통계 추출과 flags 만.
- flags: 불성실 응답 의심(모든 답이 동일/한 글자/서로 모순/무의미)만 태그. 정상 응답이면 빈 배열.
- PII 보호: [PII·출력금지] 로 표시된 값(이름·전화번호)은 판단에만 쓰고, fit_reason 등 어떤 출력에도 그 값을 인용/노출하지 마세요.
- 각 응답자의 ref 라벨(R1, R2 …)을 그대로 반환해 매핑이 유지되게 하세요.
- 정의된 JSON 스키마만 출력.${ISOLATION_NOTICE}`;

// ─── 배치 판단 ────────────────────────────────────────────────────────────
//
// 최대 20명/호출로 응답자를 묶어 판단. rows 가 20 초과면 여러 호출로 나눠
// 순차 실행(한 호출 실패가 다른 청크를 막지 않도록 청크 단위로 격리).
export async function judgeRespondents(
  anthropic: AnthropicProvider,
  criteria: RecruitingBrief['criteria'] | null,
  columns: FormColumn[],
  rows: FormResponseRow[],
): Promise<ResponseJudgment[]> {
  const out: ResponseJudgment[] = [];
  for (let start = 0; start < rows.length; start += MAX_BATCH) {
    const chunk = rows.slice(start, start + MAX_BATCH);
    // ref → response_key 매핑. 모델이 opaque id 를 망가뜨리지 않게, 짧은
    // 순번 라벨(R1…)로 전달하고 반환에서 다시 response_key 로 되돌린다.
    const refMap = new Map<string, string>();
    const batch = chunk.map((row, i) => {
      const ref = `R${i + 1}`;
      refMap.set(ref, deriveResponseKey(row));
      return { ref, row };
    });

    const { object } = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: judgmentBatchSchema,
      system: SYSTEM,
      prompt: buildPrompt(criteria, columns, batch),
      temperature: 0.1,
      providerOptions: ZERO_RETENTION,
    });

    for (const j of object.judgments) {
      const response_key = refMap.get(j.ref);
      if (!response_key) continue; // 매핑 안 되는 ref 는 버림(모델 환각 방지)
      out.push({
        response_key,
        gender: j.gender,
        age_group: j.age_group,
        region: j.region,
        fit: j.fit,
        fit_reason: j.fit_reason,
        flags: j.flags ?? [],
      });
    }
  }
  return out;
}
