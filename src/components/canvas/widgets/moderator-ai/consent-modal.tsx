'use client';

/* ────────────────────────────────────────────────────────────────────
   UtConsentModal — AI UT 세션 동의 게이트.

   화면공유 + 마이크 권한을 요청하기 전에 반드시 통과해야 하는 경고 모달
   (spec §제약 프라이버시 — 필수). 화면 녹화가 로그인·결제 같은 민감 화면을
   담을 수 있음을 명시하고, 사용자가 명시적으로 동의해야 세션이 시작된다.

   카피는 messages 의 `AiUt.consent` (en 네이티브 + ko) — 디폴트(영어) 뷰에도
   정합(한글 리터럴 가드 green).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

type Props = {
  open: boolean;
  onClose: () => void;
  onConsent: () => void;
};

export function UtConsentModal({ open, onClose, onConsent }: Props) {
  const t = useTranslations('AiUt.consent');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      labelledBy="ut-consent-title"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🔴
          </span>
          <h2
            id="ut-consent-title"
            className="text-lg font-semibold tracking-[-0.01em] text-ink-2"
          >
            {t('title')}
          </h2>
        </div>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-mute">
          <p>
            {t.rich('body', {
              b: (chunks) => <strong className="text-ink-2">{chunks}</strong>,
            })}
          </p>
          <div className="rounded-xs border-2 border-warning bg-paper-soft p-3 text-ink-2">
            {t('warning')}
          </div>
          <p className="text-xs text-mute-soft">{t('note')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={onConsent}>
            {t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
