// 프로빙 페르소나 공유 스냅샷 — shape SSOT (share-snapshot-persist PR).
//
// 프로빙 위젯의 좌패널 reflection(8 기본 + custom) 과 우패널 생성 질문은
// probing-card.tsx 의 in-memory state 라 DB 어디에도 persist 되지 않는다.
// 공유 뷰어(#476)가 그걸 read-only 로 렌더하려면 먼저 스냅샷을 DB
// (probing_sessions.persona_snapshot jsonb) 에 저장해야 한다.
//
// 이 파일은 그 스냅샷의 **wire shape 계약** — write 경로(이 PR)와 read/render
// 경로(#476)가 동일하게 참조하는 SSOT. 스키마를 바꾸면 두 경로가 같이 바뀐다.
// research_context(goal/hypotheses/KRQ)는 probing_sessions row 에 이미 있어
// 뷰어가 직접 접근하므로 스냅샷에는 in-memory 였던 것만 담는다.

import { z } from 'zod';

// 스냅샷 버전 — shape 을 파괴적으로 바꾸면 bump. 뷰어(#476)가 미지원 버전을
// gracefully skip 할 수 있게 payload 에 심는다.
//
// v2 (PR: probing-contradiction-aware-persona) — 패널에 conflicts(⚠ 모순 쌍) +
// history(이력) 를 optional 추가하고 signals 캡을 상향. write 경로는 v2 를 쓰되,
// 추가 필드가 전부 optional 이라 v1 스냅샷도 그대로 유효 → 아래 version 은
// {1,2} 를 모두 허용해 기존 공유 세션이 깨지지 않게 한다(진짜 미지원/미래 버전
// 만 safeParse 실패 → 뷰어 gracefully skip).
export const PROBING_PERSONA_SNAPSHOT_VERSION = 2 as const;

const snapshotSignalSchema = z.object({
  bullet: z.string(),
  quote: z.string().optional(),
});

// 모순 쌍 (A) — 뷰어가 read-only 로 "이전 ↔ 현재" 를 그린다.
const snapshotConflictSchema = z.object({
  field: z.string(),
  prior: z.string(),
  current: z.string(),
  note: z.string().optional(),
});

// 이력 한 칸 (B) — contradict 시 밀린 직전 값 스냅샷.
const snapshotHistorySchema = z.object({
  at: z.number(),
  summary: z.string(),
  signals: z.array(snapshotSignalSchema).max(64),
  confidence: z.enum(['high', 'medium', 'low', 'insufficient']),
  changeType: z.enum(['refine', 'contradict', 'none']).optional(),
});

// reflection 패널 한 칸 — 좌패널 grid 의 PersonaPanel 과 1:1. key/title 은
// 뷰어가 그리드를 재구성할 앵커, summary/signals/confidence 는 본문,
// conflicts/history 는 v2 의 모순 인지 + 이력 보존.
export const probingSnapshotPanelSchema = z.object({
  key: z.string(),
  title: z.string(),
  summary: z.string(),
  // 캡 상향(5 → 64): stateful 누적으로 신호가 5 를 넘어도 truncation 0.
  signals: z.array(snapshotSignalSchema).max(64),
  confidence: z.enum(['high', 'medium', 'low', 'insufficient']),
  conflicts: z.array(snapshotConflictSchema).max(16).optional(),
  history: z.array(snapshotHistorySchema).max(32).optional(),
});

// 생성된 프로빙 질문 한 줄 — 우패널 history/popup 에서 온다. technique/
// rationale/importance 는 표시 메타(있을 때만), is_starred 는 ★ 핀 여부.
export const probingSnapshotQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  technique: z.string().optional(),
  rationale: z.string().optional(),
  importance: z.string().optional(),
  is_starred: z.boolean(),
});

export const probingPersonaSnapshotSchema = z.object({
  // v1·v2 모두 허용 — v2 추가 필드가 optional 이라 v1 payload 도 유효. 미래/미지원
  // 버전만 실패 → 뷰어 gracefully skip. write 경로는 항상 최신(v2)을 쓴다.
  version: z.union([z.literal(1), z.literal(2)]),
  reflection: z.array(probingSnapshotPanelSchema).max(64),
  questions: z.array(probingSnapshotQuestionSchema).max(200),
});

export type ProbingPersonaSnapshotPanel = z.infer<
  typeof probingSnapshotPanelSchema
>;
export type ProbingPersonaSnapshotQuestion = z.infer<
  typeof probingSnapshotQuestionSchema
>;
export type ProbingPersonaSnapshot = z.infer<
  typeof probingPersonaSnapshotSchema
>;
