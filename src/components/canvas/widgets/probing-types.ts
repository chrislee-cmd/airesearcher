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
//
// key_research_question 은 우패널 UI 필드 (PR: probing-custom-section-ui) 에서
// 제거됐지만 DB row / think 프롬프트 계약을 깨지 않기 위해 타입/state 에는
// 그대로 남긴다 (신규 세션은 빈 문자열로 흐름). custom section 위젯이 KRQ 의
// UX 역할을 대체.
//
// hypotheses 는 은퇴됨 (PR: probing-hypotheses-retire-ghost-injection). 옛
// "핵심 가설" 입력은 "추가 질문 주입" 으로 재편됐으나 probing_sessions.hypotheses
// 잔존값이 매 think 에 재주입돼 유령 맥락을 오염시켰다. 클라이언트는 더 이상
// 이 필드를 수화·전송하지 않는다. DB 컬럼은 dormant 로 남는다 (파괴적 migration X).
export type ResearchContext = {
  research_goal: string;
  key_research_question: string;
  // 주입 질문 리스트 (V2 STEP4, 결정 ②) — 세션 전 "반드시 확인하고 싶은 질문".
  // research_goal(freetext) 을 대체하는 UI. research_goal 은 think/PDF 계약을 위해
  // dormant 로 남고 (KRQ·hypotheses 은퇴 패턴과 동일), 신규 세션은 이 배열만 채운다.
  // 영속화 = /api/probing/research-context (probing_sessions.injected_questions).
  injected_questions: string[];
};

// 사용자 정의 custom 페르소나 섹션 (PR: probing-custom-section-ui).
// 기본 8 섹션 뒤에 append 되어 persona LLM 이 함께 채운다. localStorage 에
// 세션 단위로 영속. key 는 crypto.randomUUID() — 기본 8 key 와 충돌 방지 +
// catchall object 응답에서 additive key 로 식별.
export type ProbingCustomSection = {
  key: string;
  title: string;
  description?: string;
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
  // PR (probing-custom-widget-priority-weight): 이 질문이 채우려는 페르소나
  // 위젯의 사람 친화 라벨 (title). think EMIT 의 target_section alias 를 client
  // 가 위젯 라벨로 되돌려 popup 뱃지에 "{라벨} 채우기" 로 표시. 특정 위젯 겨냥이
  // 아니거나 alias 매핑 실패 시 undefined.
  target_section_label?: string;
  // PR (probing-question-history-per-widget): 이 질문이 귀속되는 페르소나/custom
  // section 의 key (기본 8 섹션 key 또는 custom section uuid). think EMIT 의
  // target_section alias 를 client 가 위젯 key 로 되돌려 채운다. 위젯 카드를
  // 클릭하면 같은 section_key 로 귀속된 질문들이 팝업으로 누적 노출된다. 특정
  // 위젯 겨냥이 아니거나 alias 매핑 실패 시 undefined → 전역 폴백(기타 질문 레일).
  // in-memory 표시 전용(history 처럼 휘발) — DB/영속 스키마는 건드리지 않는다.
  section_key?: string;
};

// D. history row — popup 이 사라진 뒤 누적되는 항목. popup 의 메타에 핀 /
// dismiss 정보가 추가됨.
export type HistoryQuestion = PopupQuestion & {
  is_starred: boolean;
  dismissed_reason: 'pin' | 'auto' | 'manual' | 'replaced' | 'esc';
  // ms epoch — history 로 들어온 시각.
  dismissed_at: number;
};
