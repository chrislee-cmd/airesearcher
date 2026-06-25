'use client';

import type { WidgetContent } from '../widget-types';
import { WidgetIframe } from '../shell/widget-iframe';

// 사용자가 운영하는 별 product autocontents (chrislee-cmd/enko) 를
// canvas 에 iframe 으로 임베드. enko repo 는 그대로 — ai-researcher 가
// 별 도메인을 frame 으로 가져올 뿐. PREVIEW_FEATURES gate 로 is_unlimited
// org (사용자) 만 노출. 일반 유저 영향 0.
//
// URL 은 NEXT_PUBLIC_AUTOCONTENTS_URL 로 override 가능 — 실 production
// URL 확정 후 Vercel env 에 등록하면 코드 변경 없이 swap.
// 기본값은 현재 enko 의 작업 브랜치 preview (feat/source-extract-list).
const AUTOCONTENTS_URL =
  process.env.NEXT_PUBLIC_AUTOCONTENTS_URL ??
  'https://enko-git-feat-source-extract-list-chris-projects-eb483193.vercel.app';

function ExpandedBody() {
  return (
    <WidgetIframe src={AUTOCONTENTS_URL} title="오토컨텐츠" />
  );
}

export const autocontentsCard: WidgetContent = {
  key: 'autocontents',
  meta: {
    label: '오토컨텐츠',
    accent: 'lav',
    description: '콘텐츠 자동 생성 도구 — enko 프로젝트',
    expandedCols: 2,
    expandedRows: 3,
  },
  state: 'idle',
  ExpandedBody,
};
