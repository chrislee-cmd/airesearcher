'use client';

import { type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { TagCount } from '@/hooks/use-interview-v2-projects';

// Interview V2 — 프로젝트 목록 상단 태그 필터 chip row.
//
// org 전체 태그를 사용 빈도순으로 노출, 클릭 = 토글(multi-select). 필터 로직은
// OR (선택 태그 중 하나라도 있으면 표시 — 리서치 프로젝트 탐색에 자연). 활성
// chip = amore 강조, 선택이 있으면 "전체 해제" 링크. 선택 0 = 전체 노출.
//
// selected 는 대소문자 무시 key (lowercase) 집합. 태그가 하나도 없으면 렌더 X.
//
// native <button> 은 디자인 시스템 lint 가 src/components/ui 밖에서 금지하므로
// chip / clear 는 div[role=button] 로 구성한다 (project-list 카드와 동일 패턴).

function onEnterOrSpace(handler: () => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

export function TagFilterBar({
  tags,
  selected,
  onToggle,
  onClear,
}: {
  tags: TagCount[];
  // 선택된 태그 key (lowercase) 목록.
  selected: string[];
  onToggle: (tagKey: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  if (tags.length === 0) return null;

  const selectedSet = new Set(selected);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-mute-soft">{t('tagFilterLabel')}</span>
      {tags.map(({ tag, count }) => {
        const key = tag.toLowerCase();
        const active = selectedSet.has(key);
        return (
          <div
            key={key}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            onClick={() => onToggle(key)}
            onKeyDown={onEnterOrSpace(() => onToggle(key))}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:border-amore ${
              active
                ? 'border-amore text-amore font-medium'
                : 'border-line text-mute hover:border-ink hover:text-ink'
            }`}
          >
            {tag}
            <span className="tabular-nums opacity-60">{count}</span>
          </div>
        );
      })}
      {selected.length > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={onClear}
          onKeyDown={onEnterOrSpace(onClear)}
          className="ml-1 cursor-pointer text-xs text-mute-soft underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:text-ink"
        >
          {t('tagFilterClear')}
        </div>
      )}
    </div>
  );
}
