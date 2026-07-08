'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { isComposingEnter } from '@/components/ui/chip-input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ProjectTagEditor } from './project-tag-editor';

// Interview V2 — 프로젝트 편집 모달. 카드 kebab 메뉴의 "편집" 에서 열리며,
// 이름 · 설명 · 태그를 한 번에 저장(useInterviewV2Projects().update 로 wiring 된
// onSave). 카드에서 인라인 태그 편집기를 걷어낸 뒤(읽기전용 칩) 태그 편집의
// 유일한 진입점이 여기다.
//
// CreateProjectModal 과 같은 form-language (Modal size=sm + Input + footer).
// 부모가 target 을 세팅한 동안만 mount 한다 — 매 오픈마다 useState 가 그
// 프로젝트 값으로 새로 초기화되므로 effect 로 동기화할 필요가 없다.

export function RenameProjectModal({
  initialName,
  initialDescription,
  initialTags,
  suggestions,
  onClose,
  onSave,
}: {
  initialName: string;
  initialDescription: string | null;
  initialTags: string[];
  // org 태그 유니버스 (자동완성 소스).
  suggestions: string[];
  onClose: () => void;
  onSave: (patch: {
    name: string;
    description: string | null;
    tags: string[];
  }) => Promise<void>;
}) {
  const t = useTranslations('InterviewsV2');
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [tags, setTags] = useState<string[]>(initialTags);
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
      await onSave({
        name: trimmed,
        description: description.trim() ? description.trim() : null,
        tags,
      });
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
      title={t('editTitle')}
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
            // Enter 는 이름 칸에서만 저장 — 태그 편집기는 자체 Enter(추가) 를 갖는다.
            // IME 조합 중 Enter 는 음절 확정용 — 조기 저장 방지.
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
          maxLength={2_000}
          rows={3}
        />
        <div>
          <Label className="mb-1.5">{t('editTagsLabel')}</Label>
          <ProjectTagEditor
            tags={tags}
            suggestions={suggestions}
            onChange={setTags}
          />
        </div>
        {error && <p className="text-sm text-warning">{t('renameFailed')}</p>}
      </div>
    </Modal>
  );
}
