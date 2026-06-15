// Provider constants used by the transcripts dispatch.
//
// Provider choice is now language-driven (see languages.ts `provider` field) —
// users don't pick a model. We keep these constants here so swapping (e.g.
// scribe_v3 when it ships) is a one-line change.

export const ELEVENLABS_API_MODEL = 'scribe_v2';
