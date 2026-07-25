'use client';

/* ────────────────────────────────────────────────────────────────────
   JourneyScheduleTab — recruiting 저니 셸 탭③ 일정(Schedule) 골격.

   ⚠️ 골격(P1). CD N3(캘린더 80px/h · collapse rail · 멀티타일 채팅 ·
   확정 로스터 · D2 내부 스크롤)의 실제 본문은 **웨이브2 별도 스펙의
   워커가 이 파일을 채운다**(client 대형파일 머지 충돌 방지). 지금은 CD
   N5 empty 스타일의 빈 상태 카드만 — 실제 사용자 대상 empty(아직 일정
   없음). 탭③ 는 내부 스크롤 소유(1600×940 프레임 안, D2).

   재사용 대상(웨이브2): scheduling 캘린더/채팅/로스터 로직·fan-out·
   Realtime — 보존 계약(BUILD-SPEC §5.6) 그대로.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';

export function JourneyScheduleTab() {
  const t = useTranslations('Recruiting.journey');
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-10">
      <EmptyState
        tone="subtle"
        icon={<span className="text-3xl">🗓️</span>}
        title={t('scheduleEmptyTitle')}
        description={t('scheduleEmptyDesc')}
      />
    </div>
  );
}
