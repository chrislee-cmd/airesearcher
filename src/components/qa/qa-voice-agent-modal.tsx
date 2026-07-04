'use client';

import { Modal } from '@/components/ui/modal';

// Placeholder shell for the QA voice-feedback agent (PR3). The entry
// point (header mic button) opens this modal; the real record + upload
// logic lands in PR4, which will replace this body.
export function QaVoiceAgentModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="QA 피드백">
      <p className="text-sm text-mute">음성 녹음 기능 준비 중 (PR4)</p>
    </Modal>
  );
}
