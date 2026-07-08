'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { isComposingEnter } from '@/components/ui/chip-input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

// Interview V2 — "새 프로젝트" name/description modal. On submit it calls
// the provided onCreate (wired to useInterviewV2Projects().create) and, on
// success, hands the new project id back so the caller can jump straight
// into the detail view.

export function CreateProjectModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description?: string) => Promise<string | null>;
}) {
  const t = useTranslations('InterviewsV2');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setError(false);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      const id = await onCreate(trimmed, description.trim() || undefined);
      if (!id) {
        setError(true);
        setSubmitting(false);
        return;
      }
      reset();
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('newProject')}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
          >
            {submitting ? t('creating') : t('create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label={t('projectName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('projectNamePlaceholder')}
          maxLength={200}
          onKeyDown={(e) => {
            // IME 조합 중 Enter 는 음절 확정용 — 폼 조기 submit 방지.
            if (e.key === 'Enter' && !isComposingEnter(e)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          autoFocus
        />
        <Textarea
          label={t('projectDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('projectDescriptionPlaceholder')}
          maxLength={2000}
          rows={3}
        />
        {error && (
          <p className="text-sm text-warning">{t('createFailed')}</p>
        )}
      </div>
    </Modal>
  );
}
