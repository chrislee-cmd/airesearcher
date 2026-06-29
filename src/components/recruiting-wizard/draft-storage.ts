import type { RecruitingBrief } from '@/lib/recruiting-schema';
import type { Survey } from '@/lib/survey-schema';

type Criterion = RecruitingBrief['criteria'][number];

export type EditableBrief = {
  summary: string;
  criteria: Criterion[];
  schedule: RecruitingBrief['schedule'];
};

export type Phase = 'idle' | 'generating' | 'review' | 'approved';

export type PersistedDraft = {
  pasted: string;
  partialBrief: Partial<RecruitingBrief> | null;
  editedBrief: EditableBrief | null;
  survey: Survey | null;
  criteriaPhase: Phase;
  surveyPhase: Phase;
  savedAt: number;
};

const STORAGE_KEY = 'recruiting-wizard-draft:v1';
// Stale drafts older than this are dropped on load so a long-abandoned
// session doesn't resurface days later.
const TTL_MS = 30 * 60 * 1000;

export function persistDraft(state: Omit<PersistedDraft, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedDraft = { ...state, savedAt: Date.now() };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage may be disabled (some incognito modes) or quota
    // exceeded — swallow so OAuth navigation still proceeds.
  }
}

export function loadDraft(): PersistedDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDraft | null;
    if (!parsed || typeof parsed.savedAt !== 'number') {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// A 'generating' phase implies an in-flight LLM stream that died when
// the page navigated away — rehydrating it would leave the UI spinning
// forever, so demote to idle.
export function settleStreamingPhase(phase: Phase): Phase {
  return phase === 'generating' ? 'idle' : phase;
}
