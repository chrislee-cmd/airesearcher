'use client';

/* ────────────────────────────────────────────────────────────────────
   AI UT (moderator_ai) 위젯 본문 — 로컬/원격 두 모드.

   ▸ 로컬(내 화면 직접, 613·614): embed 없이 리서처가 자기 브라우저 새 탭에서
     실제 사이트를 보며 자유발화 → 인앱 getDisplayMedia 화면녹화 + 마이크
     보이스 → 발화 로그 + 다운로드. (기존 흐름 그대로 — 회귀 0.)
   ▸ 원격(참가자 초대): 리서처가 과제 + 대상 URL 로 세션을 만들고 참가자
     링크를 발급 → 참가자가 자기 화면을 공유 → 리서처가 viewer-token 으로
     라이브 관전(LiveKit subscribe) → 종료 후 녹화·전사 리뷰. (신규, additive.)

   두 세션 엔진(useUtSession / useUtRemoteSession)은 카드(ExpandedBody, 항상
   마운트)에 산다 — 전체보기 모달은 portal 이라 카드가 unmount 되지 않으므로
   세션이 모달 open/close 를 가로질러 살아남는다. 라이브 프리뷰/관전 <video>
   는 현재 보이는 표면(전체보기 열림=fullview, 아니면=card)에만 단일 인스턴스로
   렌더해 스트림이 한 element 에만 붙는다.

   모드 토글은 idle(양 엔진 idle)에서만 노출 — 세션이 시작되면 활성 엔진을
   따라가고 토글은 숨는다. 컨트롤 프레임은 ControlBoardPanel 슬롯 계약(#1031).
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { useUtSession, normalizeTargetUrl } from './use-ut-session';
import { useUtRemoteSession, type UtSessionKind } from './use-ut-remote-session';
import { UtConsentModal } from './consent-modal';
import { UtResultView } from './ut-result';
import { UtRemoteBody } from './ut-remote-body';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type UtMode = 'local' | 'remote';

// 모드 토글 — 로컬(내 화면)/원격(참가자 초대). idle 에서만 노출. 두 Button
// (aria-pressed) 세그먼트 — 색/radius 는 토큰만.
function ModeToggle({
  mode,
  onChange,
}: {
  mode: UtMode;
  onChange: (m: UtMode) => void;
}) {
  const t = useTranslations('AiUt');
  return (
    <div
      role="group"
      aria-label={t('mode.label')}
      className="flex gap-2 rounded-xs border border-line-soft bg-paper-soft p-1"
    >
      {(['local', 'remote'] as const).map((m) => {
        const selected = mode === m;
        return (
          <Button
            key={m}
            variant={selected ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={selected}
            onClick={() => onChange(m)}
            className="flex-1"
          >
            {t(m === 'local' ? 'mode.local' : 'mode.remote')}
          </Button>
        );
      })}
    </div>
  );
}

export function UtSessionBody() {
  const t = useTranslations('AiUt');
  const session = useUtSession();
  const remote = useUtRemoteSession();
  const [mode, setMode] = useState<UtMode>('local');
  const [targetUrl, setTargetUrl] = useState('');
  const [includeSiteAudio, setIncludeSiteAudio] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  // 원격 폼 상태 — 카드/전체보기가 공유하도록 부모 소유(로컬 targetUrl 과 동형).
  const [remoteTaskGoal, setRemoteTaskGoal] = useState('');
  const [remoteTargetUrl, setRemoteTargetUrl] = useState('');
  const [remoteSessionKind, setRemoteSessionKind] =
    useState<UtSessionKind>('moderated');
  const { isCurrent, renderInSlot, close } = useFullview('moderator_ai');
  const { setState } = useWidgetState();

  const localActive = session.phase !== 'idle';
  const remoteActive = remote.phase !== 'idle';
  // 세션이 시작되면 활성 엔진을 따라가고, 둘 다 idle 이면 토글 선택값.
  const effectiveMode: UtMode = localActive
    ? 'local'
    : remoteActive
      ? 'remote'
      : mode;
  const bothIdle = !localActive && !remoteActive;

  // 헤더 상태 pill — 활성 엔진의 phase → WidgetStateInfo.
  useEffect(() => {
    if (effectiveMode === 'remote') {
      switch (remote.phase) {
        case 'creating':
          setState({ kind: 'running', label: 'PREPARING' });
          break;
        case 'waiting':
          setState({ kind: 'running', label: 'WAITING' });
          break;
        case 'live':
          setState({ kind: 'running', label: 'MONITORING' });
          break;
        case 'review':
          if (remote.reviewStatus === 'done') setState({ kind: 'done' });
          else if (remote.reviewStatus === 'error')
            setState({ kind: 'error', message: remote.error ?? undefined });
          else setState({ kind: 'running', label: 'PROCESSING' });
          break;
        case 'error':
          setState({ kind: 'error', message: remote.error ?? undefined });
          break;
        default:
          setState({ kind: 'idle' });
      }
      return;
    }
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
  }, [
    effectiveMode,
    session.phase,
    session.error,
    remote.phase,
    remote.reviewStatus,
    remote.error,
    setState,
  ]);

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
    void session.start(targetUrl, { includeSiteAudio });
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
      {t('unsupported')}
    </div>
  );

  const idleError = isIdle && session.error && (
    <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
      {session.error}
    </div>
  );

  // 한 표면 분의 세션 콘텐츠 — 카드/전체보기가 공유. surface 로 프리뷰 부착만 분기.
  const renderContent = (surface: 'card' | 'fullview') => {
    // 원격 모드 — 활성 원격 세션이거나, idle 에서 원격을 고른 경우.
    if (effectiveMode === 'remote') {
      return (
        <UtRemoteBody
          remote={remote}
          attachMonitor={remote.attachMonitor}
          surface={surface}
          isActiveSurface={surface === activeSurface}
          topSlot={
            bothIdle ? <ModeToggle mode={mode} onChange={setMode} /> : null
          }
          taskGoal={remoteTaskGoal}
          onTaskGoal={setRemoteTaskGoal}
          targetUrl={remoteTargetUrl}
          onTargetUrl={setRemoteTargetUrl}
          sessionKind={remoteSessionKind}
          onSessionKind={setRemoteSessionKind}
        />
      );
    }

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
                  {t('live.recording', { time: formatElapsed(session.elapsedMs) })}
                </span>
                <Button variant="secondary" size="sm" onClick={session.stop}>
                  {t('cta.stop')}
                </Button>
              </div>
            </ControlBoardPanel.Region>
            <ControlBoardPanel.Region>
              {previewFor(surface)}
              <p className="mt-2 text-xs text-mute-soft">{t('live.hint')}</p>
            </ControlBoardPanel.Region>
          </ControlBoardPanel>
        </div>
      );
    }

    // idle — 모드 토글 + URL 입력 + 세션 시작(로컬).
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ControlBoardPanel gap="section" banners={unsupportedNotice || idleError || undefined}>
          <ControlBoardPanel.Region>
            <ModeToggle mode={mode} onChange={setMode} />
          </ControlBoardPanel.Region>
          <ControlBoardPanel.Input
            label={t('url.label')}
            description={t('url.description')}
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
          <ControlBoardPanel.Settings>
            <label className="flex items-start gap-2 text-sm text-mute">
              <Checkbox
                checked={includeSiteAudio}
                onChange={(e) => setIncludeSiteAudio(e.target.checked)}
                disabled={!session.isSupported}
                className="mt-[3px]"
                aria-label={t('siteAudio.label')}
              />
              <span>
                <span className="font-semibold text-ink-2">
                  {t('siteAudio.label')}
                </span>
                <br />
                <span className="text-xs-soft text-mute-soft">
                  {t('siteAudio.description')}
                </span>
              </span>
            </label>
          </ControlBoardPanel.Settings>
        </ControlBoardPanel>
        <WidgetPrimaryCta
          label={t('cta.start')}
          disabled={startDisabled}
          onClick={handleStartClick}
        />
      </div>
    );
  };

  // 전체보기 subtitle — 활성 엔진/phase 기준.
  const fullviewSubtitle =
    effectiveMode === 'remote'
      ? remote.phase === 'live'
        ? t('remote.subtitle.live')
        : remote.phase === 'review'
          ? t('subtitle.result')
          : t('remote.subtitle.idle')
      : isLive
        ? t('subtitle.live')
        : isResult
          ? t('subtitle.result')
          : t('subtitle.idle');

  return (
    <>
      {/* 카드 본문 — 항상 마운트(세션 엔진 보존). */}
      <div className="flex h-full min-h-0 flex-col">{renderContent('card')}</div>

      {/* 전체보기 — 공유 모달 slot 으로 portal. */}
      {renderInSlot(
        <WidgetFullviewPanel title="AI UT" subtitle={fullviewSubtitle} onClose={close}>
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
