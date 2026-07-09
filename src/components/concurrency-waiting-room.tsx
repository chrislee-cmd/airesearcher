'use client';

import { useTranslations } from 'next-intl';
import { BrandLoader } from '@/components/ui/brand-loader';

// 동시접속 정원 게이트 — 대기실 풀스크린 화면 (#505).
//
// GateProvider 가 phase 에 따라 앱 대신 이 화면만 렌더한다(앱 마운트 보류):
//   - connecting: 최초 ping 응답 대기. 놀라지 않게 브랜드 로더만.
//   - waiting:    "앞에 N명" + 자동 입장 안내. position 은 poll 로 실시간 갱신.
//   - error:      ping 실패로 fail-open 못 한 극단 케이스 백업 문구(재시도 중).
//
// 브랜드 톤(디자인 토큰만) 풀스크린. children 은 렌더 안 되므로 overlay 아닌
// 단독 화면 — bg-paper 로 전체를 채운다.

type Phase = 'connecting' | 'waiting' | 'error';

type Props = {
  phase: Phase;
  // waiting 일 때만 의미 있음. 백엔드 RPC 의 1-based position(맨 앞=1).
  position: number | null;
};

export function ConcurrencyWaitingRoom({ phase, position }: Props) {
  const t = useTranslations('ConcurrencyGate');

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-8 bg-paper px-6 py-16 text-center">
      <BrandLoader size={64} label={phase === 'waiting' ? t('loadingLabel') : undefined} />

      {phase === 'connecting' && (
        <p className="text-sm text-mute-soft">{t('connecting')}</p>
      )}

      {phase === 'waiting' && (
        <div className="flex max-w-md flex-col items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('title')}</h1>
          <p className="text-base leading-relaxed text-mute">{t('body')}</p>
          {position != null && (
            <p className="mt-2 text-lg font-semibold text-amore">
              {t('positionAhead', { count: position })}
            </p>
          )}
          <p className="text-sm text-mute-soft">{t('autoAdmit')}</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex max-w-md flex-col items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('errorTitle')}</h1>
          <p className="text-base leading-relaxed text-mute">{t('errorBody')}</p>
        </div>
      )}
    </div>
  );
}
