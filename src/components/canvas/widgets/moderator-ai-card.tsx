'use client';

import type { WidgetContent } from '../widget-types';
import { UtSessionBody } from './moderator-ai/ut-session-body';

// AI UT — Row 2 우측. 옛 'moderator' (휴먼 감수자) 와 별개 신 위젯.
// key 는 내부 식별자라 'moderator_ai' 유지 (표시 라벨만 AI UT).
//
// 방식 D 실기능: embed 없이 유저가 자기 브라우저 새 탭에서 실제 사이트를 보며
// 자유발화 → 인앱 화면공유(getDisplayMedia) 녹화 + 마이크 보이스(QA 배치 전사
// 재사용) → 발화 로그 + 화면녹화/오디오/전사 다운로드(613 서명 URL). 실제
// 브라우저라 로그인~구매가 네이티브로 동작. 세션 엔진은 ExpandedBody(카드,
// 항상 마운트)에 살아 전체보기 open/close 를 가로질러 보존된다.
export const moderatorAiCard: WidgetContent = {
  key: 'moderator_ai',
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051 회귀). 영문 기본 라벨.
    label: 'AI UT',
    labelKey: 'Features.moderator_ai.title',
    // Canvas 1c peach 톤 — 헤더밴드·`--widget-tone`·듀오톤 아이콘 fill 이 이 값 따라감.
    accent: 'peach',
    cost: 0,
    // PREVIEW 게이트(super-admin 노출, features.ts PREVIEW_FEATURES) — 크레딧 배지에
    // 숫자/"무료" 대신 "PREVIEW" 라벨. costLabel 이 cost 보다 우선(widget-types 계약).
    costLabel: 'PREVIEW',
    // Canvas 1c 카드 프레임 opt-in — peach 파스텔 헤더밴드 + 통합 툴바
    // (PREVIEW │ ● 상태 │ 🎨 │ ⤢ 풀뷰). probing/interpreter 와 동일 3-col span
    // (expandedRows 미지정=1 → 604×900 카드가 2×2 큰 셀에 떠 하단 공백 나지 않음).
    expandedCols: 3,
    cardFrame: true,
  },
  state: 'idle',
  ExpandedBody: UtSessionBody,
};
