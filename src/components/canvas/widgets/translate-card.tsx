'use client';

import type { WidgetContent } from '../widget-types';
import { TranslateConsole } from '@/components/translate-console';

// AI 동시통역 canvas widget — 기존 /live 페이지의 TranslateConsole 을 그대로
// widget body 로 마운트 (lightweight wrapper). desk/quotes 와 동일 패턴 — 본문
// 폴리시는 후속 PR.
function ExpandedBody() {
  return (
    <div className="p-5">
      <TranslateConsole />
    </div>
  );
}

export const translateCard: WidgetContent = {
  key: 'translate',
  meta: {
    label: 'AI 동시통역',
    accent: 'mint',
    cost: 50,
    thumbnail: '/thumbnail/interpreter.png',
    description: '마이크 음성을 실시간 STT + 동시통역. 공유 링크로 외부 청취',
    expandedCols: 3,
  },
  state: 'idle',
  ExpandedBody,
};
