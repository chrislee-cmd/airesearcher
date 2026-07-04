'use client';

import { useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { QaVoiceAgentModal } from './qa-voice-agent-modal';

// Voice-feedback entry point, shown to every signed-in account (rendered
// inside the Topbar's authed cluster). Reuses the old voice-concierge FAB
// flow (removed in PR #442): top-right mic trigger → modal. `subtle`
// variant + `md` size match the adjacent TopbarAccount gear so the mic
// reads as one family in the yellow band.
export function QaVoiceAgentButton() {
  const [open, setOpen] = useState(false);

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
