'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetUploadModal — 위젯 서브헤더 "업로드" 버튼이 여는 파일 업로드 모달.

   WidgetSettingsModal 의 자매 primitive (dropzone 특화). 전사록 / 인터뷰
   위젯이 옛 서브헤더 dropzone (FileDropZone + 변환 큐 / language confirm)
   을 이 모달 children 으로 담는다. 공유 Modal primitive (size=md, Memphis
   chrome, Esc/backdrop close, focus trap) 를 그대로 재사용 — 여기서는
   업로드 위젯 공통의 title + "닫기" footer 만 규격화.

   ⚙ 설정 (WidgetSettingsModal) 과 시각/의미를 구분 — 이건 파일 업로드
   전용. 드롭존/큐 로직은 children (호출부) 이 소유, 이 primitive 은
   껍데기만.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

export type WidgetUploadModalProps = {
  open: boolean;
  onClose: () => void;
  // 모달 헤더 타이틀. 미지정 시 로케일 default(Shell.uploadFile) — 커스텀
  // 타이틀이 필요한 호출부는 next-intl 값을 주입.
  title?: string;
  // footer 닫기 버튼 라벨. 미지정 시 Common.close.
  closeLabel?: string;
  // dropzone + 변환 큐 / language confirm 등 업로드 UI 묶음.
  children: ReactNode;
};

export function WidgetUploadModal({
  open,
  onClose,
  title,
  closeLabel,
  children,
}: WidgetUploadModalProps) {
  const t = useTranslations('Shell');
  const tCommon = useTranslations('Common');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t('uploadFile')}
      size="md"
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          {closeLabel ?? tCommon('close')}
        </Button>
      }
    >
      <div className="space-y-4">{children}</div>
    </Modal>
  );
}
