/* ────────────────────────────────────────────────────────────────────
   probing-types — probing-card 가 현재 제안 세트의 모양을 표기하는 타입.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingTechnique } from '@/lib/probing-prompts';

// 표시용 단일 질문. server schema 와 모양이 같지만 partial 스트림 동안에는
// technique 이 invalid string 일 수 있으므로 string 으로 완화.
export type ProbingQuestion = {
  text: string;
  technique: ProbingTechnique | string;
  why: string;
};

// stream 진행 중인 transient 묶음. 완료 직후 각 질문이 ProbingQuestionRow 로
// 영속화되고 current 는 다시 null.
export type ProbingSuggestionSet = {
  id: string;
  // ms epoch — 생성 시각.
  created_at: number;
  questions: ProbingQuestion[];
};

// PR-12: 개별 질문 단위 row. probing_questions 테이블 한 행 = 한 질문.
// 위젯 mount 시 GET 으로 가져오고 stream 완료 시 N 번 POST → N row prepend.
// id 는 server UUID 또는 POST 실패 시 in-memory fallback 의 'local-' prefix.
// created_at 은 ISO 8601 (timestamptz) — 표시할 때 Date.parse 로 ms 변환.
export type ProbingQuestionRow = {
  id: string;
  created_at: string;
  text: string;
  technique: ProbingQuestion['technique'];
  why: string;
  guide_reference?: string | null;
};
