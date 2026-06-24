/* ────────────────────────────────────────────────────────────────────
   probing-types — probing-card 와 probing-history-modal 이 공유하는
   세션 state 모양. 별도 파일로 둔 이유: card → modal, modal → card
   순환 import 를 피하기 위함.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingTechnique } from '@/lib/probing-prompts';

// 표시용 단일 질문. server schema 와 모양이 같지만 partial 스트림 동안에는
// technique 이 invalid string 일 수 있으므로 string 으로 완화.
export type ProbingQuestion = {
  text: string;
  technique: ProbingTechnique | string;
  why: string;
};

export type ProbingSuggestionSet = {
  // session-local id. UUID 까지 갈 필요 없음 — DB 영속 X.
  id: string;
  // ms epoch — 생성 시각.
  created_at: number;
  questions: ProbingQuestion[];
};
