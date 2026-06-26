/* ────────────────────────────────────────────────────────────────────
   probing-types — probing-card 가 현재 제안 세트의 모양을 표기하는 타입.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingTechnique } from '@/lib/probing-prompts';

// 표시용 단일 질문. server schema 와 모양이 같지만 partial 스트림 동안에는
// technique 이 invalid string 일 수 있으므로 string 으로 완화.
//
// PR-14: `why_sharp` 메타 — 이 질문이 응답자의 어느 발화 신호 (구체 단어 /
// 망설임 / 모순) 를 hook 하는지 한 줄. UI 에는 노출 X (DB row.why 에 저장
// 되어 인터뷰어 / 워커가 sharpness 를 사후 검증 가능).
export type ProbingQuestion = {
  text: string;
  technique: ProbingTechnique | string;
  why: string;
  why_sharp?: string;
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
// PR-13: is_core — 인터뷰어가 ★ 로 마킹한 핵심 질문. 표시(시각)만, 정렬 영향
// 없음. 새 row 는 default false, 토글은 PATCH /api/probing/questions/[id].
export type ProbingQuestionRow = {
  id: string;
  created_at: string;
  text: string;
  technique: ProbingQuestion['technique'];
  why: string;
  guide_reference?: string | null;
  is_core: boolean;
};
