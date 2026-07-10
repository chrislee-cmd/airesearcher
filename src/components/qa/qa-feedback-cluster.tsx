'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/icon-button';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast-provider';
import { createClient } from '@/lib/supabase/client';
import { QaVoiceAgentButton } from './qa-voice-agent-button';

// QA feedback cluster — groups the voice mic (QaVoiceAgentButton) with a new
// TEXT note trigger and a "피드백 남기기" label so testers recognise this corner
// of the Topbar as the feedback channel. The note button opens a small text
// input popover below the Topbar; submitting writes ONE qa_feedbacks row that
// mirrors the voice insert exactly — same table, same RLS (self_insert), same
// admin viewer — but with source:'text', a null audio_storage_key, the typed
// content as `transcript`, and status:'done' (no async transcribe: the text IS
// the transcript). See migration 20260710015918_qa_feedbacks_text_source.
export function QaFeedbackCluster() {
  const t = useTranslations('QaFeedback');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pathname = usePathname();
  const { push } = useToast();
  const supabase = createClient();

  // Close the popover on an outside click (same pattern as TopbarAccount).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Autofocus the textarea when the popover opens.
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setText('');
  }, []);

  const handleSubmit = useCallback(async () => {
    const content = text.trim();
    if (!content || submitting) return;
    setSubmitting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      push(t('loginRequired'), { tone: 'warn' });
      setSubmitting(false);
      return;
    }

    // Mirror the voice insert: each submission is its own session_id. Text has
    // no audio → audio_storage_key null, source 'text', status 'done' (skip the
    // transcribe round-trip entirely — the transcript is the typed content).
    const sessionId = crypto.randomUUID();
    const { error } = await supabase.from('qa_feedbacks').insert({
      user_id: user.id,
      session_id: sessionId,
      audio_storage_key: null,
      transcript: content,
      source: 'text',
      status: 'done',
      page_url: pathname ?? null,
      meta: { user_agent: navigator.userAgent },
    });

    setSubmitting(false);
    if (error) {
      push(t('submitError', { message: error.message }), { tone: 'warn' });
      return;
    }
    push(t('submitDone'), { tone: 'amore' });
    close();
  }, [text, submitting, supabase, push, t, pathname, close]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <span className="hidden text-xs font-medium text-ink sm:inline">
        {t('label')}
      </span>
      <QaVoiceAgentButton />
      <IconButton
        variant="subtle"
        size="md"
        aria-label={t('noteAria')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        📝
      </IconButton>

      {open && (
        <div
          className="absolute right-0 top-full z-modal mt-2 w-80 space-y-3 p-3"
          style={{
            background: 'var(--sidebar-nav-bg)',
            border:
              'var(--sidebar-nav-border-width) solid var(--sidebar-nav-border)',
            borderRadius: 'var(--sidebar-nav-radius)',
            boxShadow: 'var(--memphis-shadow-sm)',
          }}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
            {t('title')}
          </div>
          <Textarea
            ref={textareaRef}
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('placeholder')}
            aria-label={t('title')}
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={text.trim().length === 0 || submitting}
            >
              {t('submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
