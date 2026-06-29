'use client';

import { useEffect } from 'react';
import type { WidgetContent } from '../widget-types';
import { TranslateConsole } from '@/components/translate-console';
import { useRealtimeTranscript } from '@/components/realtime-transcript-provider';
import { useWidgetState } from '../shell/widget-state-context';

// TranslateConsole 의 status 는 내부 useState — 외부에서 못 본다. 대신
// 같은 컴포넌트가 useRealtimeTranscriptLiveBinding 으로 RealtimeTranscript
// provider 의 isLive 를 publish 하고 있으니, 그걸 consumer 측에서 읽어
// 헤더 pill 로 push. RealtimeTranscriptProvider 는 canvas page wrapper
// 가 항상 mount → 항상 동작.
function TranslateStatePush() {
  const { isLive } = useRealtimeTranscript();
  const { setState } = useWidgetState();
  useEffect(() => {
    if (isLive) {
      setState({ kind: 'running', label: 'LIVE' });
    } else {
      setState({ kind: 'idle' });
    }
  }, [setState, isLive]);
  return null;
}

// AI 동시통역 canvas widget — 기존 /live 페이지의 TranslateConsole 을 그대로
// widget body 로 마운트 (lightweight wrapper). desk/quotes 와 동일 패턴 — 본문
// 폴리시는 후속 PR.
function ExpandedBody() {
  return (
    <div className="space-y-5 px-5 py-5">
      <TranslateStatePush />
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
