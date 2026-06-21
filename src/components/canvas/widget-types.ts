/* ────────────────────────────────────────────────────────────────────
   Canvas widget — SSOT 타입.
   셸과 컨텐츠 모듈의 계약. PR1 placeholder 시점에서는 ExpandedBody 가
   안내 텍스트 + skeleton 만 그림. PR2 에서 도구별 실제 본문 (FileDropZone
   / 잡 리스트 등) 이 ExpandedBody 로 합쳐짐.
   ──────────────────────────────────────────────────────────────────── */

import type { FC } from 'react';

export type WidgetState = 'idle' | 'running' | 'done' | 'error';

export type AccentColor = 'sky' | 'peach' | 'mint' | 'lav' | 'sun' | 'rose';

export type WidgetContent = {
  key: string;
  meta: {
    label: string;
    accent: AccentColor;
    cost?: number;
    // 옵션: `/public` 아래 썸네일 경로. 지정 시 widget-shell 이 accent 박스
    // 대신 next/image 로 렌더 (PR #352 의 deskresearch.png 패턴).
    thumbnail?: string;
  };
  state: WidgetState;
  ExpandedBody: FC;
};
