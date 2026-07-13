'use client';

import { useCallback, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { IconButton } from '@/components/ui/icon-button';

// Interview V2 search — the question composer. Enter submits, Shift+Enter
// inserts a newline; we bail while an IME composition is active so Korean /
// Japanese typists don't fire mid-word (same convention as InterviewChat).

export function QuestionInput({
  onSubmit,
  disabled = false,
  placeholder,
}: {
  onSubmit: (question: string) => void;
  disabled?: boolean;
  // Override the default composer placeholder (e.g. single-file search).
  placeholder?: string;
}) {
  const t = useTranslations('InterviewsV2');
  const [value, setValue] = useState('');

  const submit = useCallback(() => {
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q);
    setValue('');
  }, [value, disabled, onSubmit]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !(
          e.nativeEvent as KeyboardEvent['nativeEvent'] & {
            isComposing?: boolean;
          }
        ).isComposing
      ) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={placeholder ?? t('searchPlaceholder')}
          disabled={disabled}
        />
      </div>
      <IconButton
        aria-label={t('searchSend')}
        variant="bordered"
        size="lg"
        onClick={submit}
        disabled={disabled || value.trim().length === 0}
      >
        →
      </IconButton>
    </div>
  );
}
