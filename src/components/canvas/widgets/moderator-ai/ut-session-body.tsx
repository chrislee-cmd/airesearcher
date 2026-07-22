'use client';

/* ────────────────────────────────────────────────────────────────────
   AI UT (moderator_ai) 위젯 본문 — 유스케이스 4-스텝 세팅 아코디언 (V2, U1).

   세팅(idle)은 UtSetupAccordion 4-스텝(프로젝트 → 테스트방식 2-카드 → 언어 →
   대상 URL·과제). 테스트방식 2-카드가 mode 매핑의 유일 배타 축:
     ▸ host "내 기기에서 테스트" → 로컬(613·614): embed 없이 리서처가 자기
       브라우저 새 탭에서 실제 사이트를 보며 자유발화 → 인앱 getDisplayMedia
       화면녹화 + 마이크 보이스 → 발화 로그 + 다운로드. (기존 흐름 — 회귀 0.)
     ▸ guest "참가자 기기에서 테스트" → 원격: 과제 + 대상 URL 로 세션 생성 +
       참가자 링크 발급 → 공유 인플레이스(링크박스+대기) → 참가자 진행 후 리뷰.

   moderated/unmoderated 는 모드가 아니라 런타임 축(합의) — 선택 스텝 없음.
   guest 생성은 session_kind='moderated' 고정(라이브 관전 옵셔널 + 사후 리뷰
   항상). 생성 API(zod input_language 필수)·participant_token·mode 매핑 불변.

   두 세션 엔진(useUtSession / useUtRemoteSession)은 카드(ExpandedBody, 항상
   마운트)에 산다 — 전체보기 모달은 portal 이라 카드가 unmount 되지 않으므로
   세션이 모달 open/close 를 가로질러 살아남는다.

   ⚠ 라이브 관전 화면(참여자 접속 중)·리뷰 fullview 는 별도 PR(U2). 이 PR 은
   세팅 + 공유 인플레이스까지.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { useFullview } from '@/components/canvas/shell/fullview-shell-context';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { useProjectSelection } from '@/components/project-selection-provider';
import { useUtSession, normalizeTargetUrl } from './use-ut-session';
import { useUtRemoteSession } from './use-ut-remote-session';
import { UtConsentModal } from './consent-modal';
import { UtResultView } from './ut-result';
import { UtRemoteBody } from './ut-remote-body';
import { UtSetupAccordion, type UtMethod } from './ut-setup-accordion';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function UtSessionBody() {
  const t = useTranslations('AiUt');
  const session = useUtSession();
  const remote = useUtRemoteSession();
  const { getSelection, setSelection } = useProjectSelection();

  // 세팅 폼 상태 — 카드/전체보기가 공유하도록 부모 소유. 테스트방식 2-카드가
  // host/guest(=local/remote) 를 고르는 유일 배타 축.
  const [method, setMethod] = useState<UtMethod | ''>('');
  const [targetUrl, setTargetUrl] = useState('');
  const [taskGoal, setTaskGoal] = useState('');
  // 예상 참여자 언어 — 미선택('')이면 시작/생성 불가(서버 400 가드의 클라 짝).
  const [inputLanguage, setInputLanguage] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);

  const projectId = getSelection('moderator_ai');

  const { isCurrent, renderInSlot, close } = useFullview('moderator_ai');
  const { setState } = useWidgetState();

  // 표면 라우팅 — 로컬 세션 활성(live/result) / 원격 공유 활성(waiting~review) /
  // 그 외(idle·생성중·에러) = 세팅 아코디언. 원격 idle/creating/error 는 세팅
  // 표면에서 CTA busy·배너로 처리(별도 idle 폼 없음).
  const localActive = session.phase !== 'idle';
  const remoteShareActive =
    remote.phase === 'waiting' ||
    remote.phase === 'live' ||
    remote.phase === 'review';
  // 세션이 시작되면 활성 엔진을 따라가고, 둘 다 idle 이면 선택한 방식.
  const effectiveMode: 'local' | 'remote' = localActive
    ? 'local'
    : remote.phase !== 'idle'
      ? 'remote'
      : method === 'guest'
        ? 'remote'
        : 'local';

  // 헤더 상태 pill — 활성 엔진의 phase → WidgetStateInfo.
  useEffect(() => {
    if (effectiveMode === 'remote') {
      switch (remote.phase) {
        case 'creating':
          setState({ kind: 'running', label: 'PREPARING' });
          break;
        case 'waiting':
          setState({
            kind: 'running',
            label:
              remote.sessionKind === 'unmoderated' &&
              remote.reviewStatus === 'live'
                ? 'IN PROGRESS'
                : 'WAITING',
          });
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
    remote.sessionKind,
    remote.error,
    setState,
  ]);

  const isLive = session.phase === 'live';
  const isResult =
    session.phase === 'uploading' ||
    session.phase === 'transcribing' ||
    session.phase === 'done' ||
    session.phase === 'error';

  const urlValid = normalizeTargetUrl(targetUrl) !== null;
  // 방식별 시작 게이트. host=지원·URL·언어 / guest=언어·과제.
  const hostDisabled = !session.isSupported || !urlValid || !inputLanguage;
  const guestDisabled = !inputLanguage || taskGoal.trim().length === 0;
  const isCreating = remote.phase === 'creating';

  const handleStartClick = () => setConsentOpen(true);
  const handleConsent = () => {
    setConsentOpen(false);
    // 사이트(탭) 소리 항상 녹음 기본 — includeSiteAudio 고정 true(토글 제거).
    // 실제 캡처는 화면공유 창의 "탭 오디오 공유" 체크에 의존(ShareGuide 안내 유지).
    // taskGoal 은 옵셔널(분석 컨텍스트) — 비면 서버에서 null.
    void session.start(targetUrl, {
      includeSiteAudio: true,
      inputLanguage,
      taskGoal,
    });
  };
  const handleCreate = () => {
    void remote.create({
      taskGoal,
      rawTargetUrl: targetUrl,
      sessionKind: 'moderated',
      inputLanguage,
    });
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

  // 세팅 표면 배너 — 미지원 안내 / 로컬·원격 에러.
  const setupBanner =
    (!session.isSupported && (
      <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
        {t('unsupported')}
      </div>
    )) ||
    (session.phase === 'idle' && session.error && (
      <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
        {session.error}
      </div>
    )) ||
    (remote.phase === 'error' && remote.error && (
      <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
        {remote.error}
      </div>
    )) ||
    undefined;

  // 한 표면 분의 세션 콘텐츠 — 카드/전체보기가 공유. surface 로 프리뷰 부착만 분기.
  const renderContent = (surface: 'card' | 'fullview') => {
    // 로컬 세션 결과(업로드·전사·완료·에러).
    if (localActive && isResult) {
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
          getPlaybackUrl={session.getPlaybackUrl}
        />
      );
    }

    // 로컬 라이브 녹화.
    if (localActive && isLive) {
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

    // 원격 공유 인플레이스(대기) · 관전 · 리뷰 — UtRemoteBody.
    if (remoteShareActive) {
      return (
        <UtRemoteBody
          remote={remote}
          attachMonitor={remote.attachMonitor}
          isActiveSurface={surface === activeSurface}
        />
      );
    }

    // 세팅 — 4-스텝 아코디언 + 방식별 CTA.
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ControlBoardPanel gap="section" banners={setupBanner} fill>
          <ControlBoardPanel.Region fill>
            <UtSetupAccordion
              surface={surface}
              projectId={projectId}
              onProjectChange={(id) => setSelection('moderator_ai', id)}
              method={method}
              onMethodChange={setMethod}
              inputLanguage={inputLanguage}
              onInputLanguage={setInputLanguage}
              targetUrl={targetUrl}
              onTargetUrl={setTargetUrl}
              taskGoal={taskGoal}
              onTaskGoal={setTaskGoal}
              supported={session.isSupported}
            />
          </ControlBoardPanel.Region>
        </ControlBoardPanel>
        {method === 'guest' ? (
          <WidgetPrimaryCta
            label={t('remote.cta.create')}
            busy={isCreating}
            busyLabel={t('remote.cta.creating')}
            disabled={guestDisabled}
            icon={<DuotoneIcon name="link" size={16} mono />}
            onClick={handleCreate}
          />
        ) : (
          <WidgetPrimaryCta
            label={t('cta.start')}
            disabled={method === '' || hostDisabled}
            onClick={handleStartClick}
          />
        )}
      </div>
    );
  };

  // 리뷰(사후 결과) 표면 — 로컬 결과 또는 원격 review. peach 헤더 + 'AI UT ·
  // Review' 타이틀 + 'Post-session review' pill 로 Canvas 1c 리뷰 fullview 정합.
  const isReviewSurface =
    isResult || (effectiveMode === 'remote' && remote.phase === 'review');

  // 전체보기 subtitle — 활성 엔진/phase 기준. 로컬 리뷰는 N participant · 시간 ·
  // PREVIEW 메타(self-capture 는 참가자 1명).
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
          ? t('fullview.reviewMeta', {
              count: 1,
              duration:
                session.result?.duration_ms != null
                  ? formatElapsed(session.result.duration_ms)
                  : '—',
            })
          : t('subtitle.idle');

  return (
    <>
      {/* 카드 본문 — 항상 마운트(세션 엔진 보존). */}
      <div className="flex h-full min-h-0 flex-col">{renderContent('card')}</div>

      {/* 전체보기 — 공유 모달 slot 으로 portal. 리뷰 표면은 peach 헤더밴드 +
          'AI UT · Review' display 타이틀 + 'Post-session review' pill 로 정합. */}
      {renderInSlot(
        <WidgetFullviewPanel
          title={isReviewSurface ? t('fullview.reviewTitle') : 'AI UT'}
          subtitle={fullviewSubtitle}
          onClose={close}
          tone={isReviewSurface ? 'var(--widget-header-bg-peach)' : undefined}
          titleDisplay={isReviewSurface}
          badge={
            isReviewSurface ? (
              <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs-soft font-semibold uppercase tracking-wider text-mute">
                {t('fullview.reviewBadge')}
              </span>
            ) : undefined
          }
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
