'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';

// 동시통역 위젯 idle(세션 시작 전) placeholder.
//
// 빈 화면 대신, 실제 자막 stream 이 "원문 | 번역" 2열로 병렬 흐를 형태를
// 흐릿하게 미리 보여줘 사용자가 "여기에 좌우 병렬 자막이 뜬다"를 직관하게
// 한다. opacity-40 + pointer-events-none + aria-hidden 으로 순수 장식 —
// 세션 시작(status==='live') 시 실 프롬프터(PrompterPane)로 교체된다.
//
// 헤더 라벨은 TranslateConsole 의 기존 sourceLang / targetLang 키를 재사용해
// bilingual (ko/en) 을 유지하고 messages/*.json 핫스팟(§7.1)을 건드리지 않는다.

// 자막 라인 쌍 — [원문 줄 수, 번역 줄 수]. 좌우 길이를 다르게 둬 실제
// 통역 자막처럼 불규칙한 흐름을 흉내낸다.
const LINE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [3, 2],
  [4, 3],
  [2, 1],
];

export function TranslateEmptySkeleton() {
  const t = useTranslations('TranslateConsole');
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none p-4 opacity-40"
    >
      <div className="grid grid-cols-2 gap-4">
        {/* header */}
        <div className="text-xs-soft text-mute">{t('sourceLang')}</div>
        <div className="text-xs-soft text-mute">{t('targetLang')}</div>
        {/* 자막 라인 병렬 — 좌(원문) | 우(번역) */}
        {LINE_PAIRS.map(([src, tgt], i) => (
          <Fragment key={i}>
            <div className="space-y-1.5 border-r border-line-soft pr-4">
              {Array.from({ length: src }).map((_, j) => (
                <Skeleton key={j} variant="text" className="h-3 w-full" />
              ))}
            </div>
            <div className="space-y-1.5">
              {Array.from({ length: tgt }).map((_, j) => (
                <Skeleton key={j} variant="text" className="h-3 w-full" />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
