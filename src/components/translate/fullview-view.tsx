'use client';

// TranslateFullviewView — READ-ONLY fullview of the live 동시통역 session.
//
// The session itself is owned by <TranslateConsole>, which stays mounted in
// the canvas card at all times. This view never hosts the session: it only
// mirrors the console's published snapshot (prompter lines + share/live
// state) and subscribes to the listener presence channel. Interpreting
// start / stop / share / mute / language controls live on the card — hence
// the bottom hint pointing the host back there.
//
// Why read-only: moving <TranslateConsole> into the modal used to unmount
// it, firing cleanup('unmount') and killing the WebRTC / LiveKit / OpenAI
// Realtime session the instant the host opened 전체 보기. Keeping the
// console in the card + rendering this mirror preserves the session.

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PrompterPane } from '@/components/translate-console';
import { ListenerPanel } from './listener-panel';
import { useTranslateSession } from './translate-session-context';

export function TranslateFullviewView({
  onGoToCard,
}: {
  onGoToCard: () => void;
}) {
  const t = useTranslations('TranslateConsole');
  // Everything is read straight from the console's published snapshot — the
  // fullview opens NO realtime channel of its own. Opening a second channel
  // on the live session's `live:<sessionId>` topic threw once the card
  // console kept its broadcast channel alive, crashing the modal.
  const { promptedLines, listeners } = useTranslateSession();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-6 py-6">
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1">
          <PrompterPane lines={promptedLines} empty={t('prompter.empty')} />
        </div>
        <ListenerPanel
          listeners={listeners}
          className="w-[300px] shrink-0 self-start"
        />
      </div>
      <div className="flex shrink-0 items-center justify-center gap-2 text-center text-sm text-mute">
        <span>{t('fullview.controlHint')}</span>
        <Button variant="link" size="sm" onClick={onGoToCard}>
          {t('fullview.backToWidget')}
        </Button>
      </div>
    </div>
  );
}
