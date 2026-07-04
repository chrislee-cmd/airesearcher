'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { IconButton } from '@/components/ui/icon-button';
import { QaVoiceAgentModal } from './qa-voice-agent-modal';

// QA-only entry point for the voice-feedback agent. Rendered in the
// Topbar right cluster next to the account pill; gated on the client-side
// `isQaTester` flag from <AuthProvider> so non-QA users never see it.
// Reuses the old voice-concierge FAB flow (removed in PR #442): top-right
// mic trigger → modal. `subtle` variant + `md` size match the adjacent
// TopbarAccount gear so the mic reads as one family in the yellow band.
export function QaVoiceAgentButton() {
  const { isQaTester } = useAuth();
  const [open, setOpen] = useState(false);

  if (!isQaTester) return null;

  return (
    <>
      <IconButton
        variant="subtle"
        size="md"
        aria-label="QA 피드백 남기기"
        onClick={() => setOpen(true)}
      >
        🎤
      </IconButton>
      <QaVoiceAgentModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
