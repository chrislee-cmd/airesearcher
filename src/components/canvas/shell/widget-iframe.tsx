'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetIframe — 외부 도구(별 도메인) 를 canvas 위젯 본문에 임베드.

   - sandbox 최소 권한 (allow-scripts allow-same-origin allow-forms
     allow-popups). 필요 시 단계적 확대.
   - loading state: 첫 onLoad 전까지 MochiLoader overlay.
   - error state: TIMEOUT_MS 안에 onLoad 가 한 번도 안 오면 "연결 실패"
     EmptyState + 새 탭 링크 (외부 도메인 자체가 살아 있는지 확인 경로).
   - iframe.onLoad 는 X-Frame-Options 거부 시에도 fire 하지만, blocked
     문서는 empty 라 사용자 눈에 "회색 박스" 로 보입니다. 그 회귀는
     spec §검증 체크포인트 의 시각 확인 단계에서 잡습니다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { MochiLoader } from '@/components/ui/mochi-loader';
import { EmptyState } from '@/components/ui/empty-state';

const LOAD_TIMEOUT_MS = 5000;

type Status = 'loading' | 'loaded' | 'error';

export function WidgetIframe({
  src,
  title,
  onError,
}: {
  src: string;
  title: string;
  onError?: () => void;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // src 는 위젯 lifetime 동안 고정 — 변경 시엔 parent 가 remount.
  // 따라서 effect 안에서 status 를 reset 하지 않습니다 (react-hooks/
  // set-state-in-effect).
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setStatus((prev) => {
        if (prev === 'loading') {
          onError?.();
          return 'error';
        }
        return prev;
      });
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onError]);

  const handleLoad = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus('loaded');
  };

  if (status === 'error') {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <EmptyState
          tone="subtle"
          title="외부 도구에 연결할 수 없습니다"
          description="네트워크 또는 외부 서비스 상태를 확인해 주세요."
          action={
            <a
              href={src}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-amore underline-offset-4 hover:underline"
            >
              새 탭에서 열기 ↗
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper">
          <MochiLoader label="불러오는 중" />
        </div>
      )}
      <iframe
        src={src}
        title={title}
        loading="lazy"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={handleLoad}
        className="block h-full w-full border-0"
      />
    </div>
  );
}
