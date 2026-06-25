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

export type ProbingSuggestionSet = {
  // session-local id. UUID 까지 갈 필요 없음 — stream 진행 중에만 사용,
  // POST 응답 받으면 ProbingSuggestionRow 로 승격.
  id: string;
  // ms epoch — 생성 시각.
  created_at: number;
  questions: ProbingQuestion[];
};

// DB row — probing_suggestions 테이블 한 행. 위젯 mount 시 GET 으로 가져오고
// 새 stream 완료 → POST 응답으로도 같은 모양을 받는다. created_at 은 ISO
// 8601 (timestamptz) — 표시할 때 Date.parse 로 ms 로 변환.
export type ProbingSuggestionRow = {
  id: string;
  created_at: string;
  questions: ProbingQuestion[];
};
