'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { WidgetContent } from '../widget-types';
import { TranslateConsole } from '@/components/translate-console';
import { TranslateSessionProvider } from '@/components/translate/translate-session-context';
import { TranslateFullviewView } from '@/components/translate/fullview-view';
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
// 전체보기 — 세션 보존이 최우선. <TranslateConsole> 이 WebRTC / LiveKit /
// OpenAI Realtime 세션을 소유하는데, 예전 코드는 isCurrent 일 때 console 을
// 모달 slot 으로 "이동" 시켰다. React 는 tree 위치가 다르면 새 instance →
// 카드의 console 이 unmount → cleanup('unmount') 가 세션을 전부 종료해서,
// 사용자가 전체 보기를 여는 순간 통역이 죽었다.
//
// Fix: console 은 항상 카드에 mount 유지 (unmount 안 됨 → 세션 생존). 모달
// slot 에는 세션을 소유하지 않는 read-only <TranslateFullviewView> 를 넣고,
// console 이 TranslateSessionProvider 로 publish 한 스냅샷 (prompter 라인 /
// 청취자용 session id / share url) 을 미러링한다. provider 는 console 과
// 모달 portal 을 둘 다 감싸야 하므로 (둘은 형제) 여기서 wrap 한다.
function ExpandedBody() {
  const { renderInSlot, close } = useFullview('translate');
  const t = useTranslations('TranslateConsole');
  return (
    <TranslateSessionProvider>
      <TranslateStatePush />
      {/* 카드에 항상 mount 유지 — 세션 소유. 모달이 열려도 unmount 되지
          않으므로 통역이 끊기지 않는다. 모달이 열린 동안은 backdrop 뒤로
          가려질 뿐이다.
          flex min-h-full — idle 센터 보드 (메인 패널 규격 통일) 가 카드
          높이를 채워 수직 center 되도록 높이 체인 제공. 콘텐츠가 카드보다
          길어지는 live 에서는 min-h 라 그대로 늘어나 기존 스크롤 유지.
          패딩 0 — 타 5위젯처럼 ControlBoardPanel 이 프레임 여백(pt-10/px-5)을
          단독 소유(부모 이중 패딩 + unpadParent 상쇄 특수 경로 제거). */}
      <div className="flex min-h-full flex-col">
        <TranslateConsole />
      </div>
      {renderInSlot(
        <WidgetFullviewPanel
          title={t('fullviewTitle')}
          subtitle={t('fullviewSubtitle')}
          onClose={close}
        >
          <TranslateFullviewView onGoToCard={close} />
        </WidgetFullviewPanel>,
      )}
    </TranslateSessionProvider>
  );
}

export const translateCard: WidgetContent = {
  key: 'translate',
  meta: {
    // labelKey 미해석 시 폴백 (blank 원천 차단 — #1051 회귀). 영문 기본 라벨.
    label: 'Live Interpreter',
    labelKey: 'Features.translate.title',
    accent: 'mint',
    cost: 50,
    thumbnail: '/thumbnail/interpreter.png',
    expandedCols: 3,
    // Canvas 1c 카드 프레임 opt-in — mint 파스텔 헤더밴드 + 통합 툴바(💎50).
    cardFrame: true,
  },
  state: 'idle',
  ExpandedBody,
};
