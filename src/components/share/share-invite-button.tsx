'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChromeButton } from '@/components/ui/chrome-button';
import {
  ShareInviteModal,
  type ShareResourceType,
} from './share-invite-modal';

// "링크로 공유" 버튼 + 공유/초대 모달 — 인터뷰 탑라인 · 프로빙 페르소나 전체보기
// 헤더에서 재사용한다. export(Notion/Google Docs) share-menu 와 시각적으로
// 구분되는 quiet chrome 버튼(🔗). resourceId 가 아직 없으면(리소스 미저장)
// disabled — 저장 후 활성화된다.

export function ShareInviteButton({
  resourceType,
  resourceId,
  disabled,
}: {
  resourceType: ShareResourceType;
  resourceId: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('Share');
  const [open, setOpen] = useState(false);
  const canShare = !disabled && !!resourceId;

  return (
    <>
      <ChromeButton
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!canShare}
        title={t('buttonHint')}
      >
        🔗 {t('button')}
      </ChromeButton>
      {resourceId ? (
        <ShareInviteModal
          open={open}
          onClose={() => setOpen(false)}
          resourceType={resourceType}
          resourceId={resourceId}
        />
      ) : null}
    </>
  );
}
