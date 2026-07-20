'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

// ─── 브라우저 공유 2-step 안내 (blocking ack) ──────────────────────────
// 온라인(both)/참관(tab) 캡처는 회의/인터뷰 오디오를 브라우저 탭 공유
// (getDisplayMedia)로 잡는다. 여기서 두 가지가 어긋나면 참석자/원음 오디오가
// 통째로 유실된다 —
//   ① 회의를 네이티브 앱(Zoom/Teams 데스크톱)으로 열면 탭 오디오가 없다.
//   ② 화면 공유 창의 "시스템 오디오도 공유" 토글을 끄면 소리가 안 담긴다.
// 이 둘을 캡처 다이얼로그(getDisplayMedia) 가 뜨기 **전에** 2-step 으로
// 안내한다. STEP 1 = 브라우저로 참가 · STEP 2 = 시스템 오디오 ON.
//
// 이 컴포넌트는 단일-스텝 BrowserAudioNotice 를 승격/대체한다. mic-only(순수
// 기기 마이크) 경로는 화면 공유가 없어 호출부에서 노출을 건너뛴다 — 여기선
// 노출 여부를 판단하지 않고 표시/확인만 담당한다.
//
// "다시 보지 않기"는 localStorage(기기별) — 억제되면 이후 세션에서 팝업 생략.
// BrowserAudioNotice 와 같은 STORAGE_KEY 를 유지해 기존 억제가 그대로 승계된다.

const STORAGE_KEY = 'browser-audio-notice-dismissed';

export type ShareGuideWidget = 'probing' | 'translate';

/** "다시 보지 않기"가 이 기기에서 켜졌는지. SSR/로컬스토리지 접근 불가 시 false. */
export function isShareGuideSuppressed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function suppressShareGuide() {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // 프라이빗 모드 등 localStorage 쓰기 실패 — best-effort. 다음 세션에
    // 다시 뜨는 것 외 부작용 없음.
  }
}

// 스크린샷 애셋(디자인 가드 예외 = 이미지). 실물 캡처 —
//   STEP 1 = Zoom "Join meeting" 화면의 "Join from browser" 버튼(앱 대신 브라우저 참가)
//   STEP 2 = Chrome 화면공유 선택창의 "시스템 오디오도 공유" 토글 ON
// 비율이 스텝마다 달라(1.22:1 / 1:1) width/height 를 실제 픽셀로 동반 —
// h-auto w-full 스케일 시 CLS(레이아웃 점프) 방지.
const STEP_ASSET = {
  1: { src: '/share-guide/zoom-browser-join.png', width: 1210, height: 988 },
  2: { src: '/share-guide/share-system-audio.png', width: 596, height: 590 },
} as const;

export function ShareGuidePopup({
  open,
  widget,
  onConfirm,
  onCancel,
  note,
}: {
  open: boolean;
  widget: ShareGuideWidget;
  onConfirm: () => void;
  onCancel: () => void;
  // 호출부가 넘기는 추가 안내(선택). 프로빙 both(진행자+응답자 병렬 캡처)는
  // 여기에 에코/이어폰 안내를 실어 브라우저 안내 + 이어폰 안내를 결합한다.
  note?: string;
}) {
  const t = useTranslations('ShareGuide');
  const [step, setStep] = useState<1 | 2>(1);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // 닫힘 경로(확인·취소)에서 스텝·체크박스를 초기화 — 이전 노출의 상태가
  // 다음 노출로 새지 않게. (effect 대신 핸들러에서 리셋.)
  const reset = () => {
    setStep(1);
    setDontShowAgain(false);
  };
  const handleCancel = () => {
    reset();
    onCancel();
  };
  const handleConfirm = () => {
    if (dontShowAgain) suppressShareGuide();
    reset();
    onConfirm();
  };

  const sub = widget === 'probing' ? t('sub.probing') : t('sub.translate');
  const s = step === 1 ? 'step1' : 'step2';

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      size="md"
      labelledBy="share-guide-title"
      footer={
        <>
          {step === 1 ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                {t('cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => setStep(2)}>
                {t('next')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                {t('prev')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleConfirm}>
                {t('confirm')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* 헤더 — 스텝 번호 배지 + 타이틀 + N/2 필 */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-md font-semibold text-ink"
          >
            {step}
          </span>
          <h2
            id="share-guide-title"
            className="flex-1 text-xl font-semibold tracking-[-0.01em] text-ink"
          >
            {t(`${s}.title`)}
          </h2>
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-mute">
            {t('step', { n: step })}
          </span>
        </div>

        <p className="text-sm leading-snug text-mute-soft">{sub}</p>

        {/* 스크린샷 프레임 (이미지 애셋) */}
        <div className="overflow-hidden rounded-sm border-2 border-ink">
          <Image
            src={STEP_ASSET[step].src}
            alt={t(`${s}.imgAlt`)}
            width={STEP_ASSET[step].width}
            height={STEP_ASSET[step].height}
            className="h-auto w-full"
            unoptimized
          />
        </div>

        <p className="text-sm leading-snug text-mute">{t(`${s}.body`)}</p>

        {/* 경고 박스 — 끄면/앱으로 열면 음성 유실. 강조색은 warning 토큰 재사용
            (프로토 #c2334f 는 proposed-token: signal-danger, 도입 전까지 warning). */}
        <p className="rounded-sm border border-warning-line bg-warning-bg px-3 py-2 text-sm font-medium leading-snug text-warning">
          {t(`${s}.warn`)}
        </p>

        {note ? (
          <p className="text-sm leading-snug text-mute">{note}</p>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <Checkbox
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          {t('dontShowAgain')}
        </label>
      </div>
    </Modal>
  );
}
