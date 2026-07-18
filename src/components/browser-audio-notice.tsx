'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

// ─── 브라우저 오디오 안내 (blocking ack) ───────────────────────────────
// 프로빙·동시통역은 회의/인터뷰 오디오를 브라우저 탭 오디오 캡처
// (getDisplayMedia)로 잡는다. Zoom/Teams 같은 네이티브 데스크톱 앱 오디오는
// 캡처 불가 — 탭 오디오만 잡힌다. 유저가 이걸 모르고 네이티브 앱으로 회의를
// 열면 소스가 안 잡혀 세션이 헛돈다. → 탭 캡처 경로로 시작을 누른 직후,
// "회의·사이트를 네이티브 앱이 아니라 브라우저(탭)에서 열어야 소리가
// 캡처된다"는 안내를 blocking ack 로 띄운다 (확인해야 캡처 진행).
//
// mic-only(순수 기기 마이크) 경로는 브라우저 설정 무관 → 호출부에서 노출을
// 건너뛴다. 여기 컴포넌트는 노출 여부를 판단하지 않고 표시/확인만 담당한다.
//
// "다시 보지 않기"는 localStorage(기기별) — DB 불필요. 억제되면 이후 세션에서
// 팝업 생략. 호출부는 시작 클릭 시 isBrowserAudioNoticeSuppressed() 로 노출
// 여부를 먼저 판단한다.

const STORAGE_KEY = 'browser-audio-notice-dismissed';

/** "다시 보지 않기"가 이 기기에서 켜졌는지. SSR/로컬스토리지 접근 불가 시 false. */
export function isBrowserAudioNoticeSuppressed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function suppressBrowserAudioNotice() {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // 프라이빗 모드 등 localStorage 쓰기 실패 — best-effort. 다음 세션에
    // 다시 뜨는 것 외 부작용 없음.
  }
}

export function BrowserAudioNotice({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('BrowserAudioNotice');
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // 닫힘 경로(확인·취소)에서 체크박스를 초기화 — 이전 노출에서 체크했다가
  // 취소한 상태가 다음 노출로 새지 않게. (effect 대신 핸들러에서 리셋.)
  const handleCancel = () => {
    setDontShowAgain(false);
    onCancel();
  };
  const handleConfirm = () => {
    if (dontShowAgain) suppressBrowserAudioNotice();
    setDontShowAgain(false);
    onConfirm();
  };

  return (
    <Modal open={open} onClose={handleCancel} size="sm" title={t('title')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-snug text-mute">{t('body')}</p>
        <p className="text-sm leading-snug text-mute-soft">{t('hint')}</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <Checkbox
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          {t('dontShowAgain')}
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            {t('cancel')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleConfirm}>
            {t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
