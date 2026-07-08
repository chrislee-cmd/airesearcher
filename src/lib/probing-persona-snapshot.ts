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
export const PROBING_PERSONA_SNAPSHOT_VERSION = 1 as const;

// reflection 패널 한 칸 — 좌패널 grid 의 PersonaPanel 과 1:1. key/title 은
// 뷰어가 그리드를 재구성할 앵커, summary/signals/confidence 는 본문.
export const probingSnapshotPanelSchema = z.object({
  key: z.string(),
  title: z.string(),
  summary: z.string(),
  signals: z
    .array(
      z.object({
        bullet: z.string(),
        quote: z.string().optional(),
      }),
    )
    .max(5),
  confidence: z.enum(['high', 'medium', 'low', 'insufficient']),
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
  version: z.literal(PROBING_PERSONA_SNAPSHOT_VERSION),
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
