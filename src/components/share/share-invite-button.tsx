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
//
// onBeforeOpen — 공유 모달을 열기(공유 시점) 직전에 호출되는 선택적 훅. 프로빙
// 페르소나가 in-memory reflection/질문을 DB 스냅샷으로 저장하는 데 쓴다
// (probing-persona-share-snapshot-persist). 미지정이면(인터뷰 탑라인 등) no-op.

export function ShareInviteButton({
  resourceType,
  resourceId,
  disabled,
  onBeforeOpen,
}: {
  resourceType: ShareResourceType;
  resourceId: string | null;
  disabled?: boolean;
  onBeforeOpen?: () => void;
}) {
  const t = useTranslations('Share');
  const [open, setOpen] = useState(false);
  const canShare = !disabled && !!resourceId;

  return (
    <>
      <ChromeButton
        size="sm"
        onClick={() => {
          onBeforeOpen?.();
          setOpen(true);
        }}
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
