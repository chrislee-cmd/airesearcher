'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Interview V2 — 프로젝트 이름 변경 모달. 카드 kebab 메뉴의 "이름 변경" 에서
// 열리며, 저장 시 useInterviewV2Projects().rename 로 wiring 된 onSave 를 호출.
// CreateProjectModal 과 같은 form-language (Modal size=sm + Input + footer).
//
// 부모가 open 인 동안만 mount 한다(CrossProjectPicker 패턴) — 매 오픈마다
// useState(initialName) 가 그 프로젝트 이름으로 새로 초기화되므로 effect 로
// 상태를 동기화할 필요가 없다.

export function RenameProjectModal({
  initialName,
  onClose,
  onSave,
}: {
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const t = useTranslations('InterviewsV2');
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(false);
    try {
      await onSave(trimmed);
      onClose();
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={handleClose}
      title={t('renameTitle')}
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
            {submitting ? t('renameSaving') : t('renameSave')}
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
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          autoFocus
        />
        {error && <p className="text-sm text-warning">{t('renameFailed')}</p>}
      </div>
    </Modal>
  );
}
