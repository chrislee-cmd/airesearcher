'use client';

/* ────────────────────────────────────────────────────────────────────
   UtConsentModal — AI UT 세션 동의 게이트.

   화면공유 + 마이크 권한을 요청하기 전에 반드시 통과해야 하는 경고 모달
   (spec §제약 프라이버시 — 필수). 화면 녹화가 로그인·결제 같은 민감 화면을
   담을 수 있음을 명시하고, 사용자가 명시적으로 동의해야 세션이 시작된다.
   ──────────────────────────────────────────────────────────────────── */

import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

type Props = {
  open: boolean;
  onClose: () => void;
  onConsent: () => void;
};

export function UtConsentModal({ open, onClose, onConsent }: Props) {
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
            화면과 음성을 녹화합니다
          </h2>
        </div>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-mute">
          <p>
            이 세션은 <strong className="text-ink-2">공유하는 화면</strong> 과{' '}
            <strong className="text-ink-2">마이크 음성</strong> 을 녹화합니다.
            녹화가 진행되는 동안 표시되는 모든 화면이 저장돼요.
          </p>
          <div className="rounded-xs border-2 border-warning bg-paper-soft p-3 text-ink-2">
            ⚠ 로그인 비밀번호·카드번호 등 민감한 정보가 화면에 보이면 함께
            녹화될 수 있어요. 공유할 탭을 신중히 고르고, 민감 정보 입력 화면은
            피해 주세요.
          </div>
          <p className="text-xs text-mute-soft">
            녹화본과 음성은 본인만 접근할 수 있는 안전한 저장소에 보관되며,
            서명 링크로만 다운로드됩니다.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" size="sm" onClick={onConsent}>
            동의하고 시작
          </Button>
        </div>
      </div>
    </Modal>
  );
}
