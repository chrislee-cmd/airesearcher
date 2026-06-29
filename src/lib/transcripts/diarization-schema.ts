import { z } from 'zod';

// Q&A 문맥 기반 diarization prompt + schema.
//
// 발동 조건: 음향 화자 1명 (speakers_count === 1) + duration ≥ 60s.
// 대표 사용자 case: 동시통역사 1명이 진행자/응답자 양쪽 발화를 통역하는 인터뷰.
//   마이크 입력 = 통역사 1인 → Deepgram/Scribe 는 speakers_count=1 로 인식 →
//   원본 전사록은 모든 발화가 "Speaker 1" → 누가 질문/답변인지 구분 0.
//   해결: 음향이 아니라 **내용 (Q&A 구조)** 기준으로 LLM 이 turn 별 host/guest
//   라벨 재할당.
//
// monologue (강연 / 1인 진술) 면 is_qa_structure=false 로 보고 → 호출자는 패스 폐기.

export const DIARIZATION_SYSTEM = `당신은 인터뷰 전사록 분석 전문가입니다.

입력: 음향 화자 1명으로 인식된 전사록의 turn 들 (순서대로).
판단: 내용이 Q&A 구조 (인터뷰 / 대화) 인지 monologue (강연 / 1인 진술) 인지.

[Q&A 구조 신호]
- 질문 패턴: "어떤", "왜", "어떻게", "...일까요?", "...이세요?", "...해주세요", "Can you...", "What...", "Why...", trailing "?"
- 답변 패턴: 질문에 대응하는 진술 / 본인 경험 / 의견 / 사례
- 화자 교대 마커: "예", "그렇죠", "음" 다음 새 주제 시작
- 통역 패턴 (동시통역사 시나리오): 같은 voice 가 한국어 질문 → 영어 답변 → 한국어 재번역 교대. 내용 기준으로 host/guest 분리.

[Monologue 신호]
- 한 주제로 연속 진술 (강연 / 발표 / 단일 응답자 인터뷰의 답변 부분만)
- 질문 없음, 본인 의견 / 경험 만 길게 진술

[라벨 종류]
- 'host' (진행자 / 인터뷰어): 짧은 turn + 질문 / 진행 신호 / 후속 질문.
- 'guest' (응답자): 긴 turn + 본인 경험 / 의견 / 사례 진술.
- 'unknown': 직전 turn 따라가도 모호한 경우만. 남용 금지 (host/guest 둘 중 하나가 디폴트).

[판단 원칙]
1. **첫 발화는 보통 host** — 진행자가 인사 / 소개 / 첫 질문을 던지는 패턴.
2. **짧고 의문문 형태 → host**, 길고 1인칭 진술 → guest.
3. 통역 교대: "그러면 ~에 대해 어떻게 생각하세요?" (host 질문) → "I think ..." 또는 "저는 ~이라고 생각해요" (guest 답변 통역) → 다음 host 질문. 같은 voice 라도 내용 기준 분리.
4. 확신이 안 서면 직전 turn 의 역할 그대로 따라가기 (대화는 보통 한 사람이 몇 turn 씩 묶임).
5. **monologue 판단**: 모든 turn 이 한 사람의 연속 진술이면 is_qa_structure=false. roles 는 모두 'guest' 로 채우되 호출자가 폐기함.
6. **반환 roles 배열 길이는 입력 turn 수와 정확히 동일** — 누락 / 추가 금지.
7. 표준 1-on-1 인터뷰 패턴이면 confidence 'high'. 통역 / 다국어 혼합이면 'medium'. 패턴이 약하면 'low'.`;

export const diarizationSchema = z.object({
  is_qa_structure: z
    .boolean()
    .describe('Q&A 구조 (인터뷰 / 대화) 검출 여부. false 면 호출자가 결과 폐기.'),
  roles: z
    .array(z.enum(['host', 'guest', 'unknown']))
    .describe(
      '각 입력 turn 의 추정 역할. 배열 길이는 입력 turn 수와 정확히 동일.',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      '전체 분류 신뢰도. 명확한 1-on-1 인터뷰 패턴이면 high, 통역 / 다국어 혼합이면 medium, 패턴 약하면 low.',
    ),
  reasoning: z
    .string()
    .describe('판단 근거 (어떤 시그널을 봤는지). audit 로그용.'),
});

export type DiarizationDecision = z.infer<typeof diarizationSchema>;
