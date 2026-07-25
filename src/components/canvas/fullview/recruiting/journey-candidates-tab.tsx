'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneyCandidatesTab — recruiting 저니 셸 탭② 명단(Candidates) 골격.

   ⚠️ 골격(P1). CD N2(소스 3-up · 리스트 컨트롤 · 벌크 바 · sticky-3col
   테이블 · 소스별 이원 PII)의 실제 본문은 **웨이브2 별도 스펙의 워커가
   이 파일을 채운다**(client 대형파일 머지 충돌 방지를 위해 신규 파일로
   분리). 지금은 CD N5 empty 스타일의 빈 상태 카드만 — "웨이브2에서 채움"
   문구 아님, 실제 사용자 대상 empty 상태(아직 후보 없음).

   재사용 대상(웨이브2): scheduling 리스트 뷰 로직/데이터 + 브리지 인제스트.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';

export function JourneyCandidatesTab() {
  const t = useTranslations('Recruiting.journey');
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-10">
      <EmptyState
        tone="subtle"
        icon={<span className="text-3xl">📋</span>}
        title={t('candidatesEmptyTitle')}
        description={t('candidatesEmptyDesc')}
      />
    </div>
  );
}
