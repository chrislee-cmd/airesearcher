'use client';

import { useTranslations } from 'next-intl';
import { DropdownMenu, type DropdownItem } from '@/components/ui/dropdown-menu';
import { ControlTrigger } from '@/components/ui/control-trigger';
import type { FormColumn } from '@/lib/google-forms';

/* ────────────────────────────────────────────────────────────────────
   UploadedListToolbar — ①응답 "업로드 명단"(intake) 세그먼트의 정렬·필터
   피커 (card 594). 폼 소스 툴바(recruiting-fullview-body.tsx)와 같은
   DropdownMenu + ControlTrigger chrome 을 미러링해 시각 일치.

   presentational only: 컬럼 목록·현재 선택값·distinct 값·핸들러를 받는다.
   정렬/필터 파생 로직(rows 가공)과 state 는 호출부(body)가 소유(spec §B/§D).
   정렬/필터 패턴 자체는 admin/recruiting-scheduling-client 의 검증된
   filterKey/filterValue + sortKey/sortDir 이식.
   ──────────────────────────────────────────────────────────────────── */
export function UploadedListToolbar({
  columns,
  sortKey,
  sortDir,
  filterKey,
  filterValue,
  filterValues,
  onSortKeyChange,
  onSortDirChange,
  onFilterKeyChange,
  onFilterValueChange,
}: {
  columns: FormColumn[];
  sortKey: string;
  sortDir: 'asc' | 'desc';
  filterKey: string;
  filterValue: string;
  filterValues: string[];
  onSortKeyChange: (key: string) => void;
  onSortDirChange: (dir: 'asc' | 'desc') => void;
  onFilterKeyChange: (key: string) => void;
  onFilterValueChange: (value: string) => void;
}) {
  const t = useTranslations('Recruiting.fv');

  const columnTitle = (key: string) =>
    columns.find((c) => c.questionId === key)?.title ?? '';

  // 정렬 컬럼 피커 — "기본 순서"(해제) + 각 컬럼. 라벨은 columns[].title.
  const sortItems: DropdownItem[] = [
    {
      key: '__none',
      label: t('uploadSortNone'),
      onSelect: () => onSortKeyChange(''),
    },
    ...columns.map((c) => ({
      key: c.questionId,
      label: c.title,
      onSelect: () => onSortKeyChange(c.questionId),
    })),
  ];

  const sortDirItems: DropdownItem[] = [
    {
      key: 'asc',
      label: t('uploadSortAsc'),
      onSelect: () => onSortDirChange('asc'),
    },
    {
      key: 'desc',
      label: t('uploadSortDesc'),
      onSelect: () => onSortDirChange('desc'),
    },
  ];

  // 필터 컬럼 피커 — "전체"(해제) + 각 컬럼.
  const filterItems: DropdownItem[] = [
    {
      key: '__all',
      label: t('uploadFilterAll'),
      onSelect: () => onFilterKeyChange(''),
    },
    ...columns.map((c) => ({
      key: c.questionId,
      label: c.title,
      onSelect: () => onFilterKeyChange(c.questionId),
    })),
  ];

  // 필터 값 피커 — "전체 값"(값 해제) + 선택 컬럼의 distinct 값.
  const filterValueItems: DropdownItem[] = [
    {
      key: '__all',
      label: t('uploadFilterValueAll'),
      onSelect: () => onFilterValueChange(''),
    },
    ...filterValues.map((v) => ({
      key: v,
      label: v,
      onSelect: () => onFilterValueChange(v),
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      {/* 정렬: 컬럼 + 방향(방향은 컬럼 선택 시에만). */}
      <div className="min-w-[150px]">
        <DropdownMenu
          items={sortItems}
          trigger={({ open, onClick, ...aria }) => (
            <ControlTrigger
              {...aria}
              data-open={open}
              onClick={onClick}
              aria-label={t('uploadSortBy')}
            >
              {sortKey ? columnTitle(sortKey) : t('uploadSortBy')}
            </ControlTrigger>
          )}
        />
      </div>
      {sortKey && (
        <div className="min-w-[110px]">
          <DropdownMenu
            items={sortDirItems}
            trigger={({ open, onClick, ...aria }) => (
              <ControlTrigger
                {...aria}
                data-open={open}
                onClick={onClick}
                aria-label={
                  sortDir === 'asc' ? t('uploadSortAsc') : t('uploadSortDesc')
                }
              >
                {sortDir === 'asc' ? t('uploadSortAsc') : t('uploadSortDesc')}
              </ControlTrigger>
            )}
          />
        </div>
      )}

      {/* 필터: 컬럼 + 값(값은 컬럼 선택 시에만). */}
      <div className="min-w-[150px]">
        <DropdownMenu
          items={filterItems}
          trigger={({ open, onClick, ...aria }) => (
            <ControlTrigger
              {...aria}
              data-open={open}
              onClick={onClick}
              aria-label={t('uploadFilterBy')}
            >
              {filterKey ? columnTitle(filterKey) : t('uploadFilterBy')}
            </ControlTrigger>
          )}
        />
      </div>
      {filterKey && (
        <div className="min-w-[150px]">
          <DropdownMenu
            items={filterValueItems}
            trigger={({ open, onClick, ...aria }) => (
              <ControlTrigger
                {...aria}
                data-open={open}
                onClick={onClick}
                aria-label={t('uploadFilterValue')}
              >
                {filterValue || t('uploadFilterValue')}
              </ControlTrigger>
            )}
          />
        </div>
      )}
    </div>
  );
}
