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
  };
  state: WidgetState;
  ExpandedBody: FC;
};
