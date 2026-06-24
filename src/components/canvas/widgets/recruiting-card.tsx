'use client';

import { useEffect, useState } from 'react';
import type { WidgetContent } from '../widget-types';
import { RecruitingWizard } from '@/components/recruiting-wizard';
import {
  WidgetOutputRow,
  WidgetOutputs,
} from '@/components/canvas/shell/widget-outputs';
import {
  useRecruitingForms,
  RecruitingFormsModal,
  RecruitingOutputActions,
  formatTime,
} from './recruiting-card-outputs';

// 본문 (RecruitingWizard, 3-step 카드) + 바닥 산출물 영역. 전사록/데스크
// 위젯과 동일한 flex column 패턴 — 중간이 flex-1 로 늘어나고 산출물이
// 카드 바닥에 고정. 산출물 데이터는 사용자가 Google 을 연결한 뒤
// /forms/list 를 30 s 주기로 폴링. 폴링은 위젯이 열려있는 동안만
// (hook unmount 시 정리).
function ExpandedBody() {
  const [googleConnected, setGoogleConnected] = useState(false);
  const [publishVersion, setPublishVersion] = useState(0);
  const [showAll, setShowAll] = useState(false);

  // Google 연결 여부는 publish 이전부터 알아야 함 — 비연결 사용자에게는
  // 바닥 산출물 영역이 "Google 미연결" 안내로 빈 상태를 그림.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/recruiting/google/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setGoogleConnected(!!j.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // RecruitingWizard 가 polling 호출에 의존하지 않고 publish 직후 곧바로
  // 새 폼이 바닥 산출물 영역에 보이도록 publishVersion 을 bump 하는 콜백.
  // 본문에서 fetch 가 200 으로 끝나는 순간 window 이벤트로 트리거.
  useEffect(() => {
    function onPublished() {
      setPublishVersion((v) => v + 1);
    }
    window.addEventListener('recruiting:published', onPublished);
    return () => window.removeEventListener('recruiting:published', onPublished);
  }, []);

  const { forms, linking, linkError, linkSheet } = useRecruitingForms({
    enabled: googleConnected,
    publishVersion,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5">
          <RecruitingWizard />
        </div>
      </div>
      <WidgetOutputs
        label="최근 산출물"
        items={forms}
        onMoreClick={() => setShowAll(true)}
        emptyText={
          googleConnected
            ? '발행된 폼이 아직 없습니다'
            : 'Google 계정을 연결하면 발행한 폼이 여기에 모입니다'
        }
        renderItem={(f) => (
          <WidgetOutputRow
            key={f.formId}
            title={f.title || '제목 없음'}
            meta={<span>발행 {formatTime(f.createdAt)}</span>}
            actions={
              <RecruitingOutputActions
                form={f}
                linking={linking === f.formId}
                onLinkSheet={linkSheet}
              />
            }
          />
        )}
      />
      <RecruitingFormsModal
        open={showAll}
        onClose={() => setShowAll(false)}
        forms={forms}
        linking={linking}
        linkError={linkError}
        onLinkSheet={linkSheet}
      />
    </div>
  );
}

// 리크루팅 canvas widget — 3-step 카드 wizard (조건 → 설문 → Google Form)
// 를 widget body 에 마운트. PREVIEW_FEATURES 에 속해 canvas/page.tsx 의
// server-side preview gate 가 일반 유저에게 자동 숨김.
export const recruitingCard: WidgetContent = {
  key: 'recruiting',
  meta: {
    label: '리크루팅',
    accent: 'sun',
    cost: 10,
    thumbnail: '/thumbnail/recruiting.png',
    description:
      '리서치 목적·페르소나·문항 초안을 LLM 으로 한 번에 생성합니다.',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
