// Shared QA-feedback tag catalogue. Single source of truth reused by three
// call sites so the label/key/group set can never drift between them:
//   1. <QaVoiceAgentModal /> form step  — the checkboxes a tester picks before
//      recording ("어떤 항목에 대한 피드백인가요?").
//   2. <QaFeedbackList /> admin filter   — the chip toggles that narrow the
//      viewer, plus the per-card tag badges.
// Tags are stored as a plain string array under qa_feedbacks.meta.tags
// (e.g. ["transcripts", "ux"]) — no migration, meta is already jsonb.

export type QaTagGroup = 'feature' | 'general';

export type QaTag = {
  key: string;
  label: string;
  group: QaTagGroup;
};

export const QA_TAGS: QaTag[] = [
  // 기능
  { key: 'transcripts', label: '전사록', group: 'feature' },
  { key: 'desk', label: '데스크 리서치', group: 'feature' },
  { key: 'interviews_v2', label: '인터뷰 결과 생성기', group: 'feature' },
  { key: 'probing', label: '프로빙 어시스턴트', group: 'feature' },
  { key: 'translate', label: 'AI 동시통역', group: 'feature' },
  { key: 'recruiting', label: '리크루팅', group: 'feature' },
  // 전반 카테고리
  { key: 'design', label: '전반적 디자인/UI', group: 'general' },
  { key: 'ux', label: '전반적 사용경험/UX', group: 'general' },
  { key: 'etc', label: '기타', group: 'general' },
];

// key → label lookup for rendering badges from stored keys. Falls back to the
// raw key so an unknown/legacy tag still renders rather than disappearing.
export const QA_TAG_LABEL: Record<string, string> = Object.fromEntries(
  QA_TAGS.map((t) => [t.key, t.label]),
);
