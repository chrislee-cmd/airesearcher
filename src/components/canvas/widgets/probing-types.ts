/* ────────────────────────────────────────────────────────────────────
   probing-types — probing-card 가 현재 제안 세트의 모양을 표기하는 타입.
   ──────────────────────────────────────────────────────────────────── */

import type {
  ProbingTechnique,
  ProbingThinkImportance,
} from '@/lib/probing-prompts';

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

/* ────────────────────────────────────────────────────────────────────
   PR (probing-question-thinking-flow) — 우패널 4-layer 신규 타입.
   ──────────────────────────────────────────────────────────────────── */

// A. 입력 패널이 다루는 사용자 입력. 영속화 row 와 1:1.
export type ResearchContext = {
  research_goal: string;
  hypotheses: string[];
  key_research_question: string;
};

// B. AI 사고 흐름 라인 — `THINK: ...` 의 본문.
export type ThinkingEvent = {
  id: string;
  // ms epoch 도착 시각.
  at: number;
  text: string;
};

// C. popup queue 의 개별 항목. EMIT 의 JSON payload 와 1:1 + 표시용 메타.
//
// importance 는 신호 강도 visual cue 의 분기점. high → 빨강 + 두꺼운 그림자,
// medium → 표준, low → 톤 다운. 자세한 매핑은 question-popup.tsx 에.
//
// dismissed_reason — popup → history 로 옮길 때 같이 기록. 'pin' / 'auto'
// (15s timeout) / 'manual' (✕) / 'replaced' (다중 emit 큐) / 'esc'. UI 가
// history 안에서 미세 표시 (현재는 사용 안 함 — 향후 확장 여지).
export type PopupQuestion = {
  id: string;
  text: string;
  technique: ProbingTechnique | string;
  rationale: string;
  importance: ProbingThinkImportance;
  // ms epoch — emit 도착 시각 (popup 표시 시작).
  emitted_at: number;
};

// D. history row — popup 이 사라진 뒤 누적되는 항목. popup 의 메타에 핀 /
// dismiss 정보가 추가됨.
export type HistoryQuestion = PopupQuestion & {
  is_starred: boolean;
  dismissed_reason: 'pin' | 'auto' | 'manual' | 'replaced' | 'esc';
  // ms epoch — history 로 들어온 시각.
  dismissed_at: number;
};
