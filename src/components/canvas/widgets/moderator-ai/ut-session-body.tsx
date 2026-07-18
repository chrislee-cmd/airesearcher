'use client';

/* ────────────────────────────────────────────────────────────────────
   AI UT (moderator_ai) 위젯 실 본문 — 화면공유 + 보이스 세션.

   방식 D: embed 없이 유저가 자기 브라우저 새 탭에서 실제 사이트를 보며
   자유발화 → 인앱 getDisplayMedia 화면녹화 + 마이크 보이스(QA 배치 전사
   재사용) → 발화 로그 + 화면녹화/오디오/전사 다운로드.

   세션 엔진(useUtSession)은 카드(ExpandedBody, 항상 마운트)에 산다 — 전체보기
   모달은 portal 이라 카드가 unmount 되지 않으므로 세션이 모달 open/close 를
   가로질러 살아남는다(probing/translate 와 동일 패턴). 라이브 프리뷰 <video>
   는 현재 보이는 표면(전체보기 열림=fullview, 아니면=card)에만 단일 인스턴스로
   렌더해 스트림이 한 element 에만 붙는다.

   컨트롤 프레임은 ControlBoardPanel 슬롯 계약(#1031) — 프레임 토큰 하드코드
   금지, 색/radius 는 design-system 토큰만.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { useUtSession, normalizeTargetUrl } from './use-ut-session';
import { UtConsentModal } from './consent-modal';
import { UtResultView } from './ut-result';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function UtSessionBody() {
  const session = useUtSession();
  const [targetUrl, setTargetUrl] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const { isCurrent, renderInSlot, close } = useFullview('moderator_ai');
  const { setState } = useWidgetState();

  // 헤더 상태 pill — phase → WidgetStateInfo.
  useEffect(() => {
    switch (session.phase) {
      case 'live':
        setState({ kind: 'running', label: 'RECORDING' });
        break;
      case 'uploading':
        setState({ kind: 'running', label: 'UPLOADING' });
        break;
      case 'transcribing':
        setState({ kind: 'running', label: 'TRANSCRIBING' });
        break;
      case 'done':
        setState({ kind: 'done' });
        break;
      case 'error':
        setState({ kind: 'error', message: session.error ?? undefined });
        break;
      default:
        setState({ kind: 'idle' });
    }
  }, [session.phase, session.error, setState]);

  const isIdle = session.phase === 'idle';
  const isLive = session.phase === 'live';
  const isResult =
    session.phase === 'uploading' ||
    session.phase === 'transcribing' ||
    session.phase === 'done' ||
    session.phase === 'error';

  const urlValid = normalizeTargetUrl(targetUrl) !== null;
  const startDisabled = !session.isSupported || !urlValid;

  const handleStartClick = () => setConsentOpen(true);
  const handleConsent = () => {
    setConsentOpen(false);
    void session.start(targetUrl);
  };

  // 현재 보이는 표면 — 프리뷰 <video> 를 여기에만 렌더(단일 스트림 부착).
  const activeSurface: 'card' | 'fullview' = isCurrent ? 'fullview' : 'card';

  const previewFor = (surface: 'card' | 'fullview') =>
    surface === activeSurface ? (
      <video
        ref={session.attachPreview}
        className="aspect-video w-full rounded-xs border border-line-soft bg-ink"
        muted
        autoPlay
        playsInline
      />
    ) : null;

  const unsupportedNotice = !session.isSupported && (
    <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
      이 브라우저는 화면 공유 녹화를 지원하지 않아요. 데스크톱 Chrome·Edge 등
      최신 브라우저에서 이용해 주세요.
    </div>
  );

  const idleError = isIdle && session.error && (
    <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
      {session.error}
    </div>
  );

  // 한 표면 분의 세션 콘텐츠 — 카드/전체보기가 공유. surface 로 프리뷰 부착만 분기.
  const renderContent = (surface: 'card' | 'fullview') => {
    if (isResult) {
      return (
        <UtResultView
          phase={session.phase}
          result={session.result}
          error={session.error}
          onDownloadRecording={() => void session.download('recording')}
          onDownloadAudio={() => void session.download('audio')}
          onDownloadTranscript={session.downloadTranscript}
          onRetry={session.retryUpload}
          onReset={session.reset}
        />
      );
    }

    if (isLive) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <ControlBoardPanel active gap="section">
            <ControlBoardPanel.Region>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <span aria-hidden>🔴</span>
                  녹화 중 · {formatElapsed(session.elapsedMs)}
                </span>
                <Button variant="secondary" size="sm" onClick={session.stop}>
                  세션 종료
                </Button>
              </div>
            </ControlBoardPanel.Region>
            <ControlBoardPanel.Region>
              {previewFor(surface)}
              <p className="mt-2 text-xs text-mute-soft">
                공유한 탭에서 자유롭게 사용하며 소리 내어 생각을 말해 주세요.
                종료하면 발화가 전사됩니다.
              </p>
            </ControlBoardPanel.Region>
          </ControlBoardPanel>
        </div>
      );
    }

    // idle — URL 입력 + 세션 시작.
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ControlBoardPanel gap="section" banners={unsupportedNotice || idleError || undefined}>
          <ControlBoardPanel.Input
            label="대상 사이트 URL"
            description="테스트할 사이트 주소예요. 세션을 시작하면 새 탭으로 열려요."
            htmlFor={`ut-url-${surface}`}
          >
            <Input
              id={`ut-url-${surface}`}
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
              autoComplete="off"
              disabled={!session.isSupported}
            />
          </ControlBoardPanel.Input>
        </ControlBoardPanel>
        <WidgetPrimaryCta
          label="세션 시작"
          disabled={startDisabled}
          onClick={handleStartClick}
        />
      </div>
    );
  };

  return (
    <>
      {/* 카드 본문 — 항상 마운트(세션 엔진 보존). */}
      <div className="flex h-full min-h-0 flex-col">{renderContent('card')}</div>

      {/* 전체보기 — 공유 모달 slot 으로 portal. */}
      {renderInSlot(
        <WidgetFullviewPanel
          title="AI UT"
          subtitle={
            isLive
              ? '세션 진행 중'
              : isResult
                ? '세션 결과'
                : '화면공유 + 보이스 사용성 테스트'
          }
          onClose={close}
        >
          <div className="flex h-full min-h-0 flex-col">
            {renderContent('fullview')}
          </div>
        </WidgetFullviewPanel>,
      )}

      <UtConsentModal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        onConsent={handleConsent}
      />
    </>
  );
}
