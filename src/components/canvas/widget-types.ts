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
    // 옵션: 헤더 타이틀 아래 부제 1줄 (line-clamp-1). messages 의
    // Features.{key}.description 과 일관성 유지.
    description?: string;
    // 옵션: expand 시 셀 몇 개 너비로 확장할지. 미지정 = 2.
    // 1: collapsed 와 동일 너비 (240) — vertical 만 확장
    // 2: 두 셀 너비 (528 = 240 + 48 + 240) — 일반 도구
    // 3: 세 셀 너비 (816 = 240 + 48 + 240 + 48 + 240) — 전사록/데스크
    //    처럼 가로 정보 밀도 높은 본문
    expandedCols?: 1 | 2 | 3;
    // 옵션: 위젯이 차지하는 row 수. 미지정 = 1.
    // 1: 한 셀 높이 (800)
    // 2: 두 셀 높이 (1648 = 800 + 48 + 800)
    // 3: 세 셀 높이 (2496 = 800 + 48 + 800 + 48 + 800) — autocontents
    //    같이 본문 분량이 많은 도구
    expandedRows?: 1 | 2 | 3;
  };
  state: WidgetState;
  ExpandedBody: FC;
};
