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
import { ChromeInput } from '@/components/ui/chrome-input';
import { ChromeButton } from '@/components/ui/chrome-button';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import {
  useFullview,
  useFullviewChrome,
} from '@/components/canvas/shell/fullview-shell-context';
import {
  FullviewProjectPill,
  FullviewStatusChip,
  FullviewEndSessionButton,
} from '@/components/canvas/fullview/fullview-header';
import { AiutLiveMonitor } from '@/components/canvas/fullview/aiut/aiut-live-monitor';
import { AiutReviewReport } from '@/components/canvas/fullview/aiut/aiut-review-report';
import { useWidgetState } from '@/components/canvas/shell/widget-state-context';
import { AudioCheckStep } from '@/components/media/audio-check-step';
import { useAudioVerificationGate } from '@/hooks/use-audio-verification-gate';
import { useProjectSelection } from '@/components/project-selection-provider';
import { useInterviewV2Projects } from '@/hooks/use-interview-v2-projects';
import { useUtSession, normalizeTargetUrl } from './use-ut-session';
import type { UtPhase } from './use-ut-session';
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

// 라이브 관전 REC 경과(ms) — active 인 동안만 매초 갱신. 시작시각은 effect
// 진입 시 로컬 const 로 캡처하고, setState 는 interval 콜백에서만 부른다
// (react-hooks/set-state-in-effect 회피). 비활성이면 0.
function useRecElapsed(active: boolean, intervalMs = 1000): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return active ? elapsed : 0;
}

export function UtSessionBody() {
  const t = useTranslations('AiUt');
  const session = useUtSession();
  const remote = useUtRemoteSession();
  const { getSelection, setSelection } = useProjectSelection();

  // 실측 오디오 게이트 — 로컬(host) 세션은 마이크 + 사이트(탭) 오디오 둘 다
  // 요구(includeSiteAudio 고정 true). verifying 중에만 스트림이 non-null 이라
  // 그 외 phase 에선 no-op. 신호가 확인돼야만 confirmStart CTA 가 열린다.
  const audioGate = useAudioVerificationGate({
    require: { mic: true, tabAudio: true },
    micStream: session.micStream,
    tabStream: session.tabStream,
  });

  // 세팅 폼 상태 — 카드/전체보기가 공유하도록 부모 소유. 테스트방식 2-카드가
  // host/guest(=local/remote) 를 고르는 유일 배타 축.
  const [method, setMethod] = useState<UtMethod | ''>('');
  const [targetUrl, setTargetUrl] = useState('');
  const [taskGoal, setTaskGoal] = useState('');
  // 예상 참여자 언어 — 미선택('')이면 시작/생성 불가(서버 400 가드의 클라 짝).
  const [inputLanguage, setInputLanguage] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  // 풀뷰 empty 프레임 공유링크 복사 표시 — UtRemoteBody 의 copied 와 독립(다른 표면).
  const [fvCopied, setFvCopied] = useState(false);

  const projectId = getSelection('moderator_ai');

  const {
    isCurrent,
    renderInSlot,
    renderInHeaderStart,
    renderInHeaderEnd,
    close,
  } = useFullview('moderator_ai');
  const fullviewChrome = useFullviewChrome();
  const { setState } = useWidgetState();

  // 풀뷰 V2 헤더 프로젝트 pill 표시명 — 미선택/미매칭이면 폴백 라벨.
  const { projects } = useInterviewV2Projects();
  const fullviewProjectName =
    projects.find((p) => p.id === projectId)?.name ??
    t('fullview.projectFallback');

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
      case 'verifying':
        setState({ kind: 'running', label: 'AUDIO CHECK' });
        break;
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

  // 원격 라이브 관전 모니터(state 06) — REC 경과. 원격 훅은 라이브 시작시각을
  // 노출하지 않으므로 관전 진입 순간을 로컬에서 스탬프해 카운트한다(근사).
  const remoteLive = effectiveMode === 'remote' && remote.phase === 'live';
  const recElapsedMs = useRecElapsed(remoteLive);

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
  const copyParticipantLink = async () => {
    if (!remote.participantUrl) return;
    try {
      await navigator.clipboard.writeText(remote.participantUrl);
      setFvCopied(true);
      setTimeout(() => setFvCopied(false), 1600);
    } catch {
      // clipboard 차단 — readOnly 필드에서 직접 복사 가능.
    }
  };

  // 현재 보이는 표면 — 프리뷰 <video> 를 여기에만 렌더(단일 스트림 부착).
  const activeSurface: 'card' | 'fullview' = isCurrent ? 'fullview' : 'card';

  // 실측 게이트 패널 — 캡처 프리뷰 + AudioCheckStep(VU 미터/실패 CTA/시작 게이트).
  const audioCheck = (
    <AudioCheckStep
      state={audioGate}
      selectedMicId={session.selectedMicId}
      onSelectDevice={(id) => void session.selectMicDevice(id)}
      onRetryTab={() => void session.retryTab()}
      onProceed={() => void session.confirmStart()}
      onCancel={session.cancelVerify}
    />
  );

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

    // 로컬 실측 오디오 게이트(verifying) — 프리뷰 + VU 미터, 통과해야 live.
    if (localActive && session.phase === 'verifying') {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <ControlBoardPanel active gap="section">
            <ControlBoardPanel.Region>
              {previewFor(surface)}
            </ControlBoardPanel.Region>
            <ControlBoardPanel.Region>{audioCheck}</ControlBoardPanel.Region>
          </ControlBoardPanel>
        </div>
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

  // ── 풀뷰 V2 디폴트 표면 = CD state 06 empty case 프레임 ──────────────────
  // 사용자 결정(2026-07-26): 풀뷰 비-라이브/비-리뷰 표면은 위젯 본문 폴백이
  // 아니라 state 06 지오메트리의 empty case. AiutLiveMonitor 의 idle variant 로
  // 렌더(같은 컴포넌트 = 드리프트 0). **우 레일 상단 = assigned task 카드
  // (design state 06, 과제 없으면 dashed empty)** — 세팅 뷰가 아니라 태스크 카드.
  // 세션 시작 경로(세팅 4-스텝·시작 CTA)는 **좌측 모니터 본문**에 얹는다.
  // 공유대기는 링크 패널만 railCardSlot 로 override. 카드뷰는 불변(풀뷰 한정).
  const renderFullviewDefault = () => {
    const normalizedUrl = normalizeTargetUrl(targetUrl);

    // 0) 로컬 실측 오디오 게이트(verifying) — 좌 모니터에 프리뷰 + VU 미터.
    //    우 레일 = assigned task 카드(taskGoal). 통과해야 live 로.
    if (localActive && session.phase === 'verifying') {
      return (
        <AiutLiveMonitor
          variant="idle"
          targetUrl={normalizedUrl}
          taskGoal={taskGoal}
          showThinkAloud={false}
          monitorSlot={
            <div className="flex h-full w-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
              {activeSurface === 'fullview' ? (
                <video
                  ref={session.attachPreview}
                  className="aspect-video w-full rounded-xs border border-line-soft bg-ink object-contain"
                  muted
                  autoPlay
                  playsInline
                />
              ) : null}
              {audioCheck}
            </div>
          }
        />
      );
    }

    // 1) 로컬 라이브 녹화 — 셀프 프리뷰 + 활성 REC + 종료 CTA(위젯 본문 재노출 X).
    //    우 레일 = assigned task 카드(taskGoal, AiutLiveMonitor 기본 렌더).
    if (localActive && isLive) {
      return (
        <AiutLiveMonitor
          variant="idle"
          targetUrl={normalizedUrl}
          taskGoal={taskGoal}
          statusTone="rec"
          recElapsedMs={session.elapsedMs}
          showThinkAloud={false}
          monitorSlot={
            <>
              {activeSurface === 'fullview' ? (
                <video
                  ref={session.attachPreview}
                  className="h-full w-full bg-ink object-contain"
                  muted
                  autoPlay
                  playsInline
                />
              ) : null}
              <div className="absolute bottom-3 right-3">
                <Button variant="secondary" size="sm" onClick={session.stop}>
                  {t('cta.stop')}
                </Button>
              </div>
            </>
          }
        />
      );
    }

    // 2) 원격 공유 대기 — 참가자 링크 발급/대기(관전 전). live/review 는 상위
    //    remoteLive/isReviewSurface 가 이미 가로채므로 여기 도달하는 건 waiting.
    //    우 레일 = 링크 공유 패널(override), 모니터 본문 = 대기 안내 + 복사 CTA.
    if (remoteShareActive) {
      return (
        <AiutLiveMonitor
          variant="idle"
          targetUrl={remote.result?.target_url ?? normalizedUrl}
          showThinkAloud={false}
          monitorSlot={
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="font-mono-label text-sm text-faint">
                {t('fv.idle.waitingHeading')}
              </p>
              <p className="max-w-[360px] text-sm text-mute">
                {t('remote.waiting.status')}
              </p>
            </div>
          }
          railCardSlot={
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-sm border-2 border-ink bg-peach-bg px-[15px] py-[13px] shadow-memphis-sm">
              <div className="flex items-center gap-[7px]">
                <DuotoneIcon
                  name="link"
                  size={18}
                  fill="var(--widget-header-bg-peach)"
                />
                <span className="text-md font-extrabold text-ink">
                  {t('remote.share.label')}
                </span>
              </div>
              <ChromeInput
                readOnly
                value={remote.participantUrl ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                className="!border-line-soft !text-ink font-mono"
                aria-label={t('remote.share.label')}
              />
              <ChromeButton size="md" onClick={() => void copyParticipantLink()}>
                {fvCopied ? t('remote.share.copied') : t('remote.share.copy')}
              </ChromeButton>
              <p className="text-xs text-mute-soft">
                {t('remote.share.description')}
              </p>
              <div className="mt-auto">
                <Button variant="ghost" size="sm" onClick={remote.reset}>
                  {t('remote.waiting.cancel')}
                </Button>
              </div>
            </div>
          }
        />
      );
    }

    // 3) 세팅(idle) — 좌측 모니터 본문에 4-스텝 아코디언 + 방식별 주 CTA(하단 바).
    //    우 레일 = assigned task 카드(taskGoal 반영, empty 시 dashed) + think-aloud.
    return (
      <AiutLiveMonitor
        variant="idle"
        targetUrl={normalizedUrl}
        taskGoal={taskGoal}
        monitorSlot={
          <div className="flex h-full w-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <UtSetupAccordion
                surface="fullview"
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
              {setupBanner && <div className="mt-3">{setupBanner}</div>}
            </div>
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
        }
      />
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

  // ── 풀뷰 V2 리뷰 표면(state 07) 데이터 — 활성 엔진(로컬/원격)에서 해석 ──
  const reviewResult = effectiveMode === 'remote' ? remote.result : session.result;
  const reviewPhase = (effectiveMode === 'remote'
    ? remote.reviewStatus ?? 'done'
    : session.phase) as UtPhase;
  const reviewTaskGoal = taskGoal.trim() || reviewResult?.task_goal || '';

  return (
    <>
      {/* 카드 본문 — 항상 마운트(세션 엔진 보존). */}
      <div className="flex h-full min-h-0 flex-col">{renderContent('card')}</div>

      {/* ── 풀뷰 V2 (캔버스 모달) ── FullviewShell(§F1~F3)에 배선. 본문은 fresh
          AiutLiveMonitor(state 06 live)·AiutReviewReport(state 07); 그 외 디폴트
          (세팅/공유대기/로컬녹화)는 AiutLiveMonitor idle variant = state 06
          empty case(2026-07-26 사용자 결정, 위젯 본문 폴백 제거). 헤더는
          pill(좌)+REC chip/End-session·리뷰 pill(우) 슬롯으로 portal. */}
      {fullviewChrome === 'modal' ? (
        <>
          {renderInHeaderStart(
            <FullviewProjectPill name={fullviewProjectName} />,
          )}
          {renderInHeaderEnd(
            remoteLive ? (
              <>
                <FullviewStatusChip
                  label={`${t('fv.live.recTag')} ${formatElapsed(recElapsedMs)}`}
                  tone="rec"
                />
                <FullviewEndSessionButton
                  onClick={remote.stopMonitoring}
                  label={t('fv.live.endSession')}
                />
              </>
            ) : isReviewSurface ? (
              // 리뷰 표면 — dot-less 'Post-session review' pill(CD state 07).
              <span className="inline-flex shrink-0 items-center rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1 text-sm font-bold text-ink">
                {t('fullview.reviewBadge')}
              </span>
            ) : null,
          )}
          {renderInSlot(
            remoteLive ? (
              <AiutLiveMonitor
                targetUrl={remote.result?.target_url ?? normalizeTargetUrl(targetUrl)}
                taskGoal={reviewTaskGoal}
                recElapsedMs={recElapsedMs}
                hasParticipantVideo={remote.hasParticipantVideo}
                isActiveSurface={activeSurface === 'fullview'}
                attachMonitor={remote.attachMonitor}
                captionLines={remote.captionLines}
                captionStatus={remote.captionStatus}
              />
            ) : isReviewSurface ? (
              <AiutReviewReport
                phase={reviewPhase}
                result={reviewResult}
                error={effectiveMode === 'remote' ? remote.error : session.error}
                taskGoal={reviewTaskGoal}
                onDownloadRecording={() =>
                  void (effectiveMode === 'remote'
                    ? remote.download('recording')
                    : session.download('recording'))
                }
                onDownloadAudio={() =>
                  void (effectiveMode === 'remote'
                    ? remote.download('audio')
                    : session.download('audio'))
                }
                onDownloadTranscript={
                  effectiveMode === 'remote'
                    ? remote.downloadTranscript
                    : session.downloadTranscript
                }
                onRetry={
                  effectiveMode === 'remote' ? undefined : session.retryUpload
                }
                onReset={
                  effectiveMode === 'remote' ? remote.reset : session.reset
                }
                getPlaybackUrl={
                  effectiveMode === 'remote' ? undefined : session.getPlaybackUrl
                }
              />
            ) : (
              // 디폴트(세팅/공유대기/로컬 라이브녹화/생성중) = state 06 empty
              // case 프레임(사용자 결정 2026-07-26). 위젯 본문 폴백 제거.
              renderFullviewDefault()
            ),
          )}
        </>
      ) : (
        // ── 레거시 (리스트/page) ── 아직 V2 전환 전 표면. WidgetFullviewPanel
        // 그대로(회귀 0). 리뷰 표면은 peach 헤더밴드 + Review 타이틀 + pill.
        renderInSlot(
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
        )
      )}

      <UtConsentModal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        onConsent={handleConsent}
      />
    </>
  );
}
