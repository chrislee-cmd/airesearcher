import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────
   probing-guide — projects.interview_template 의 PR-3 확장 layer.

   배경: `interview_template` jsonb 는 0015 마이그에서 `{ questions: [],
   source_filename, uploaded_at }` 모양으로 만들어졌고, 인터뷰 가이드 파일을
   업로드한 뒤 분석 파이프라인이 "표준 질문" 으로 사용합니다.

   PR-3 는 같은 jsonb 안에 probing 어시스턴트가 사용할 별도 키들을
   덧붙입니다 (legacy `questions[]` 는 그대로 보존):
     - `objective`         : 조사 목적 1-3 문장
     - `hypotheses`        : 핵심 가설 목록
     - `question_intents`  : 질문별 의도 (질문 한 줄 + 의도 한 줄)

   schema 가 columns 가 아니라 jsonb 안 키이므로 마이그레이션 없음.
   parser 는 forwards-compatible — 알 수 없는 키는 그대로 통과시켜
   legacy reader / writer 와 겹쳐 살아도 안전합니다.
   ──────────────────────────────────────────────────────────────────── */

// 가설 한 건. id 는 LLM 이 라벨링할 때 짧고 안정적인 식별자가 필요해서
// 분리. label 은 사이드바 칩에 표시되는 짧은 문구, detail 은 한 문장 설명.
export const probingHypothesisSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  detail: z.string().max(400),
});

// 질문 의도 한 건. question 은 가이드에 적힌 질문 그대로, intent 는 그
// 질문으로 검증/탐색하려는 것 한 문장.
export const probingIntentSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().min(1).max(280),
  intent: z.string().max(400),
});

export const probingGuideSchema = z.object({
  objective: z.string().max(800).default(''),
  hypotheses: z.array(probingHypothesisSchema).max(30).default([]),
  question_intents: z.array(probingIntentSchema).max(40).default([]),
});

export type ProbingHypothesis = z.infer<typeof probingHypothesisSchema>;
export type ProbingIntent = z.infer<typeof probingIntentSchema>;
export type ProbingGuide = z.infer<typeof probingGuideSchema>;

export const EMPTY_GUIDE: ProbingGuide = {
  objective: '',
  hypotheses: [],
  question_intents: [],
};

// LLM 라벨링이 사용할 안정적 ID. UUID 까지 갈 필요 없음 — jsonb 안에서만
// 의미. 길이 8 으로 충돌 사실상 제로 (1.5M id 까지 < 1% 충돌).
export function newGuideEntryId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// jsonb 전체에서 PR-3 키만 추출. 알 수 없는 키 (legacy `questions` 등) 는
// 무시. parse 가 실패하면 빈 가이드를 반환 — UI 가 "가이드 없음" 으로
// fallback 하고 입력하면 PUT 으로 정상 복구됨.
export function parseProbingGuide(raw: unknown): ProbingGuide {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GUIDE };
  const obj = raw as Record<string, unknown>;
  const candidate = {
    objective: obj.objective ?? '',
    hypotheses: obj.hypotheses ?? [],
    question_intents: obj.question_intents ?? [],
  };
  const parsed = probingGuideSchema.safeParse(candidate);
  if (!parsed.success) return { ...EMPTY_GUIDE };
  return parsed.data;
}

// 기존 jsonb 위에 PR-3 키만 selective merge. legacy `questions[]`,
// `source_filename`, `uploaded_at` 같은 미지의 키는 보존. partial 키만
// 들어왔을 때 (예: objective 만 갱신) 도 안전.
export function mergeProbingGuide(
  existing: unknown,
  patch: Partial<ProbingGuide>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>) }
      : {};
  if (patch.objective !== undefined) base.objective = patch.objective;
  if (patch.hypotheses !== undefined) base.hypotheses = patch.hypotheses;
  if (patch.question_intents !== undefined) {
    base.question_intents = patch.question_intents;
  }
  return base;
}

// 가이드가 실제로 의미 있는 컨텐츠를 가지고 있는지. objective + 가설/의도가
// 모두 비어 있으면 LLM prompt 에 가이드 블록을 끼우지 않음 (PR-2 동작 복귀).
export function hasGuideContent(g: ProbingGuide): boolean {
  return (
    g.objective.trim().length > 0 ||
    g.hypotheses.length > 0 ||
    g.question_intents.length > 0
  );
}
