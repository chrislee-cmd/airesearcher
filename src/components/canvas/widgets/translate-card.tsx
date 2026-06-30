'use client';

import { useEffect } from 'react';
import type { WidgetContent } from '../widget-types';
import { TranslateConsole } from '@/components/translate-console';
import { useRealtimeTranscript } from '@/components/realtime-transcript-provider';
import { useWidgetState } from '../shell/widget-state-context';
import { WidgetFullviewPanel } from '../shell/widget-fullview-panel';
import { useFullview } from '../shell/fullview-shell-context';

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
// widget body 로 마운트 (lightweight wrapper). desk/quotes 와 동일 패턴.
//
// 전체보기 — 공유 모달이 소유. translate 가 currentKey 일 때만 TranslateConsole
// 을 모달 slot 으로 portal 한다. isCurrent 분기로 카드/모달 중 한 곳에서만
// 렌더하므로 console 은 항상 단일 인스턴스 (두 instance → 두 세션 위험 회피).
// 세션/transcript 는 page-level RealtimeTranscriptProvider 가 보유하므로
// console 이 remount 돼도 보존된다 (provider hoist 불필요).
function ExpandedBody() {
  const { isCurrent, renderInSlot, close } = useFullview('translate');
  return (
    <>
      <TranslateStatePush />
      {isCurrent ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm italic text-mute-soft">
          전체 보기에서 작업 중 — 모달을 닫으면 여기로 돌아옵니다.
        </div>
      ) : (
        <div className="space-y-5 px-5 py-5">
          <TranslateConsole />
        </div>
      )}
      {renderInSlot(
        <WidgetFullviewPanel
          title="AI 동시통역"
          subtitle="마이크 음성을 실시간 STT + 동시통역"
          onClose={close}
        >
          <div className="space-y-5 px-6 py-6">
            <TranslateConsole showListeners />
          </div>
        </WidgetFullviewPanel>,
      )}
    </>
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
