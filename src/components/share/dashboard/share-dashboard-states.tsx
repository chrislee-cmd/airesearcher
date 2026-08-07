'use client';

import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { Pressable } from '@/components/artifacts/library/pressable';

const OUTFIT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;

// 빈 상태(4a) — 발급 링크 0건. **필터 빈 결과(4c)와 다른 화면**(탈출구가 다름):
// 4a 는 발급 동선(산출물 탭)으로 보내고, 4c 는 필터를 푼다. 조직 전체 스코프의
// 0건은 문구만 교체(§6-6): variant="org".
export function ShareDashboardEmpty({
  variant,
  onOpenArtifacts,
}: {
  variant: 'default' | 'org';
  onOpenArtifacts: () => void;
}) {
  const t = useTranslations('ShareDashboard');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <div className="flex h-[70px] w-[70px] items-center justify-center rounded-modal border-[3px] border-ink bg-paper shadow-memphis-lg-faint">
        <DuotoneIcon name="link" size={34} />
      </div>
      <div className="text-3xl font-extrabold text-ink" style={OUTFIT}>
        {variant === 'org' ? t('emptyOrg.title') : t('empty.title')}
      </div>
      <p className="max-w-[520px] text-lg leading-relaxed text-mute">
        {t.rich('empty.body', {
          b: (chunks) => <b className="font-bold text-ink">{chunks}</b>,
        })}
      </p>
      <Pressable
        onPress={onOpenArtifacts}
        className="mt-1 inline-flex cursor-pointer items-center gap-2 rounded-pill bg-ink px-5 py-[11px] text-lg font-extrabold text-paper shadow-memphis-md"
      >
        {t('empty.cta')}
      </Pressable>
    </div>
  );
}

// 필터 빈 결과(4c) — 시각 무게를 4a 보다 낮춘다(dashed 보더 · 그림자 없음).
export function ShareDashboardFilteredEmpty({
  total,
  onClear,
}: {
  total: number;
  onClear: () => void;
}) {
  const t = useTranslations('ShareDashboard');
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 p-10 text-center">
      <div className="flex h-[62px] w-[62px] items-center justify-center rounded-panel-lg border-[2.5px] border-dashed border-line-empty bg-paper">
        <DuotoneIcon name="link" size={28} stroke="var(--color-mute-soft)" />
      </div>
      <div className="text-2xl font-extrabold text-ink" style={OUTFIT}>
        {t('filteredEmpty.title')}
      </div>
      <p className="max-w-[480px] text-md leading-relaxed text-mute">
        {t('filteredEmpty.body', { total })}
      </p>
      <Pressable
        onPress={onClear}
        className="inline-flex cursor-pointer items-center gap-[7px] rounded-pill border-[1.5px] border-ink bg-paper px-[15px] py-2 text-md font-bold text-ink shadow-memphis-sm-faint"
      >
        {t('filteredEmpty.clear', { total })}
      </Pressable>
    </div>
  );
}

// 로딩 skeleton(4b) — 실제 행 리듬 유지(pad 13/24 · 타일 34 · 5개 열) · opacity
// 래더 1 → 0.32. skeleton 이 행 높이를 바꾸면 로드 완료 시 목록이 튄다(§1.9).
// 셸 색 토큰(surface-disabled/paper-soft)로 라이브러리 skeleton 과 통일(§3-2).
const LADDER = [1, 0.78, 0.56, 0.42, 0.32];

export function ShareDashboardSkeleton() {
  return (
    <div aria-hidden>
      {LADDER.map((op, i) => (
        <div
          key={i}
          className="flex items-center gap-[11px] border-b border-line px-6 py-[13px]"
          style={{ opacity: op }}
        >
          <div className="h-[34px] w-[34px] shrink-0 rounded-icon bg-surface-disabled" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3 w-[46%] rounded-2xs bg-surface-disabled" />
            <div className="h-[9px] w-[22%] rounded-2xs bg-paper-soft" />
          </div>
          <div className="flex w-[210px] shrink-0 gap-[5px]">
            <div className="h-[17px] w-[72px] rounded-xs bg-paper-soft" />
            <div className="h-[17px] w-[72px] rounded-xs bg-paper-soft" />
          </div>
          <div className="flex w-[126px] shrink-0 flex-col gap-1.5">
            <div className="h-[11px] w-[38px] rounded-2xs bg-surface-disabled" />
            <div className="h-2 w-[66px] rounded-2xs bg-paper-soft" />
          </div>
          <div className="flex w-[150px] shrink-0 flex-col gap-1.5">
            <div className="h-[11px] w-[52px] rounded-2xs bg-surface-disabled" />
            <div className="h-2 w-[58px] rounded-2xs bg-paper-soft" />
          </div>
          <div className="w-[108px] shrink-0">
            <div className="h-[21px] w-16 rounded-pill bg-surface-disabled" />
          </div>
          <div className="flex w-[236px] shrink-0 justify-end gap-[7px]">
            <div className="h-[27px] w-[82px] rounded-pill bg-surface-disabled" />
            <div className="h-[27px] w-[74px] rounded-pill bg-paper-soft" />
            <div className="h-[27px] w-[48px] rounded-pill bg-paper-soft" />
          </div>
        </div>
      ))}
    </div>
  );
}
