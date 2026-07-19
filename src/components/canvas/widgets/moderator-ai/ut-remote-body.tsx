'use client';

/* ────────────────────────────────────────────────────────────────────
   UtRemoteBody — AI UT 원격 모드(리서처 오케스트레이션/모니터) 표면.

   흐름: 과제 입력(idle) → 세션 생성 → participant_url 발급 + 참가자 대기
   (waiting) → 참가자 화면 라이브 관전(live) → 참가자 종료 후 사후 리뷰(review,
   녹화·전사 다운로드는 로컬과 동일 UtResultView 재사용).

   프레임은 ControlBoardPanel 슬롯 계약 — 색/radius 는 design-system 토큰만,
   임의 layout 클래스 금지. 라이브 관전 <video> 는 현재 보이는 단일 표면에만
   렌더(스트림 단일 부착) — 로컬 프리뷰와 동형.
   ──────────────────────────────────────────────────────────────────── */

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { ChromeInput } from '@/components/ui/chrome-input';
import { SelectMenu } from '@/components/ui/select-menu';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { WidgetPrimaryCta } from '@/components/canvas/shell/widget-primary-cta';
import { UtLanguageSelect } from './ut-language-select';
import { UtResultView } from './ut-result';
import type {
  UseUtRemoteSession,
  UtSessionKind,
} from './use-ut-remote-session';

type Props = {
  remote: UseUtRemoteSession;
  // 라이브 관전 <video> ref 콜백 — 별도 prop 으로 받는다. `remote.attachMonitor`
  // 를 직접 `ref=` 에 쓰면 react-hooks/refs 가 `remote` 전체를 ref 로 오인해
  // 모든 `remote.*` 접근을 render-중-ref-접근으로 잘못 잡는다(prop 경유 hook
  // 반환의 한계). 직접 hook 을 호출하는 부모에서 넘겨주면 그 오인이 사라진다.
  attachMonitor: (el: HTMLVideoElement | null) => void;
  surface: 'card' | 'fullview';
  isActiveSurface: boolean;
  // 상단 모드 토글(로컬/원격) — idle 에서만 노출. 부모가 소유.
  topSlot: ReactNode;
  taskGoal: string;
  onTaskGoal: (v: string) => void;
  targetUrl: string;
  onTargetUrl: (v: string) => void;
  sessionKind: UtSessionKind;
  onSessionKind: (v: UtSessionKind) => void;
  // 예상 참여자 언어 — 미선택('')이면 생성 불가(강제 선택). 부모 소유.
  inputLanguage: string;
  onInputLanguage: (v: string) => void;
};

export function UtRemoteBody({
  remote,
  attachMonitor,
  surface,
  isActiveSurface,
  topSlot,
  taskGoal,
  onTaskGoal,
  targetUrl,
  onTargetUrl,
  sessionKind,
  onSessionKind,
  inputLanguage,
  onInputLanguage,
}: Props) {
  const t = useTranslations('AiUt');
  const [copied, setCopied] = useState(false);

  const monitorVideo = isActiveSurface ? (
    <video
      ref={attachMonitor}
      className="aspect-video w-full rounded-xs border border-line-soft bg-ink"
      autoPlay
      playsInline
    />
  ) : null;

  const copyLink = async () => {
    if (!remote.participantUrl) return;
    try {
      await navigator.clipboard.writeText(remote.participantUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard 차단 — 사용자가 필드에서 직접 복사 가능(readOnly select).
    }
  };

  // ── review — 참가자 종료 후 결과(녹화·전사 다운로드) ──────────────────
  if (remote.phase === 'review') {
    const status = remote.reviewStatus;
    const isResultReady =
      status === 'uploading' ||
      status === 'transcribing' ||
      status === 'done' ||
      status === 'error';
    if (isResultReady) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <UtResultView
            phase={status as 'uploading' | 'transcribing' | 'done' | 'error'}
            result={remote.result}
            error={remote.error}
            onDownloadRecording={() => void remote.download('recording')}
            onDownloadAudio={() => void remote.download('audio')}
            onDownloadTranscript={remote.downloadTranscript}
            onReset={remote.reset}
          />
        </div>
      );
    }
    // 참가자가 아직 세션 진행 중(관전만 종료) — 처리 대기 + 새로고침.
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ControlBoardPanel gap="section">
          <ControlBoardPanel.Region>
            <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
              {t('remote.review.pending')}
            </div>
          </ControlBoardPanel.Region>
          <ControlBoardPanel.Action align="between">
            <Button variant="secondary" size="sm" onClick={remote.refreshReview}>
              {t('remote.review.refresh')}
            </Button>
            <Button variant="ghost" size="sm" onClick={remote.reset}>
              {t('cta.newSession')}
            </Button>
          </ControlBoardPanel.Action>
        </ControlBoardPanel>
      </div>
    );
  }

  // ── live — 참가자 화면 라이브 관전 ──────────────────────────────────
  if (remote.phase === 'live') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ControlBoardPanel active gap="section">
          <ControlBoardPanel.Region>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-warning">
                <span aria-hidden>🔴</span>
                {t('remote.live.watching')}
              </span>
              <Button variant="secondary" size="sm" onClick={remote.stopMonitoring}>
                {t('remote.live.stop')}
              </Button>
            </div>
          </ControlBoardPanel.Region>
          <ControlBoardPanel.Region>
            {monitorVideo}
            <p className="mt-2 text-xs text-mute-soft">{t('remote.live.hint')}</p>
          </ControlBoardPanel.Region>
        </ControlBoardPanel>
      </div>
    );
  }

  // ── waiting — 링크 발급 + 참가자 대기/진행 ──────────────────────────
  if (remote.phase === 'waiting') {
    const isUnmoderated = remote.sessionKind === 'unmoderated';

    // 공통 — 참가자 링크 공유 region. 설명 문구만 kind 로 분기(언모더는 라이브
    // 관전을 암시하지 않는다).
    const shareRegion = (
      <ControlBoardPanel.Region label={t('remote.share.label')}>
        <div className="flex flex-wrap items-center gap-2">
          <ChromeInput
            readOnly
            value={remote.participantUrl ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-[220px] max-w-[420px] flex-1 !border-line-soft !text-ink font-mono"
            aria-label={t('remote.share.label')}
          />
          <ChromeButton size="md" onClick={() => void copyLink()}>
            {copied ? t('remote.share.copied') : t('remote.share.copy')}
          </ChromeButton>
        </div>
        <p className="mt-2 text-xs text-mute-soft">
          {isUnmoderated
            ? t('remote.unmoderated.shareDescription')
            : t('remote.share.description')}
        </p>
      </ControlBoardPanel.Region>
    );

    // ── 언모더레이티드 — 라이브 pane 없음. 참여자 진행 상태 + 완료 후 리뷰
    //    안내. reviewStatus 폴링: null/'waiting' = 대기(미참여), 'live' =
    //    진행중(참여). 완료(uploading→…) 시엔 폴링이 phase 를 'review' 로
    //    넘겨 위의 review 블록이 처리한다.
    if (isUnmoderated) {
      const inProgress = remote.reviewStatus === 'live';
      return (
        <div className="flex h-full min-h-0 flex-col">
          <ControlBoardPanel gap="section">
            <ControlBoardPanel.Region
              label={t('remote.unmoderated.explainTitle')}
            >
              <p className="text-sm text-mute">
                {t('remote.unmoderated.explain')}
              </p>
            </ControlBoardPanel.Region>
            {shareRegion}
            <ControlBoardPanel.Region
              label={t('remote.unmoderated.stateLabel')}
            >
              <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
                <span className="mr-1" aria-hidden>
                  {inProgress ? '🟢' : '⌛'}
                </span>
                {inProgress
                  ? t('remote.unmoderated.stateInProgress')
                  : t('remote.unmoderated.stateWaiting')}
              </div>
              <p className="mt-2 text-xs text-mute-soft">
                {t('remote.unmoderated.reviewHint')}
              </p>
            </ControlBoardPanel.Region>
            <ControlBoardPanel.Action>
              <Button variant="ghost" size="sm" onClick={remote.reset}>
                {t('remote.waiting.cancel')}
              </Button>
            </ControlBoardPanel.Action>
          </ControlBoardPanel>
        </div>
      );
    }

    // ── 모더레이티드 (기존) — 참가자 참여 시 라이브 관전으로 전환. 불변.
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ControlBoardPanel gap="section">
          {shareRegion}
          <ControlBoardPanel.Region>
            <div className="rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
              <span className="mr-1" aria-hidden>
                ⏳
              </span>
              {t('remote.waiting.status')}
            </div>
          </ControlBoardPanel.Region>
          <ControlBoardPanel.Action>
            <Button variant="ghost" size="sm" onClick={remote.reset}>
              {t('remote.waiting.cancel')}
            </Button>
          </ControlBoardPanel.Action>
        </ControlBoardPanel>
      </div>
    );
  }

  // ── idle / creating — 과제 입력 + 세션 생성 ─────────────────────────
  const isCreating = remote.phase === 'creating';
  // 언어 미선택('')이면 생성 불가 — 서버 400 가드의 클라 짝(강제 선택).
  const startDisabled =
    isCreating || taskGoal.trim().length === 0 || inputLanguage.length === 0;
  const idleError = remote.phase === 'error' && remote.error && (
    <div className="rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
      {remote.error}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ControlBoardPanel gap="section" banners={idleError || undefined}>
        <ControlBoardPanel.Region>{topSlot}</ControlBoardPanel.Region>
        <ControlBoardPanel.Input
          label={t('remote.task.label')}
          description={t('remote.task.description')}
          htmlFor={`ut-task-${surface}`}
        >
          <Textarea
            id={`ut-task-${surface}`}
            value={taskGoal}
            onChange={(e) => onTaskGoal(e.target.value)}
            placeholder={t('remote.task.placeholder')}
            rows={3}
            disabled={isCreating}
          />
        </ControlBoardPanel.Input>
        <ControlBoardPanel.Input
          label={t('remote.url.label')}
          description={t('remote.url.description')}
          htmlFor={`ut-remote-url-${surface}`}
        >
          <Input
            id={`ut-remote-url-${surface}`}
            value={targetUrl}
            onChange={(e) => onTargetUrl(e.target.value)}
            placeholder="https://example.com"
            inputMode="url"
            autoComplete="off"
            disabled={isCreating}
          />
        </ControlBoardPanel.Input>
        <ControlBoardPanel.Input
          label={t('language.label')}
          description={t('language.description')}
          required
        >
          <UtLanguageSelect
            value={inputLanguage}
            onChange={onInputLanguage}
            disabled={isCreating}
          />
        </ControlBoardPanel.Input>
        <ControlBoardPanel.Settings>
          <div className="min-w-[180px]">
            <p className="mb-1.5 text-xs uppercase tracking-[0.22em] text-mute-soft">
              {t('remote.kind.label')}
            </p>
            <SelectMenu
              value={sessionKind}
              onChange={(v) => onSessionKind(v as UtSessionKind)}
              disabled={isCreating}
              aria-label={t('remote.kind.label')}
              options={[
                {
                  value: 'moderated',
                  label: t('remote.kind.moderated'),
                },
                {
                  value: 'unmoderated',
                  label: t('remote.kind.unmoderated'),
                },
              ]}
            />
          </div>
        </ControlBoardPanel.Settings>
      </ControlBoardPanel>
      <WidgetPrimaryCta
        label={t('remote.cta.create')}
        busy={isCreating}
        busyLabel={t('remote.cta.creating')}
        disabled={startDisabled}
        icon="🔗"
        onClick={() =>
          void remote.create({
            taskGoal,
            rawTargetUrl: targetUrl,
            sessionKind,
            inputLanguage,
          })
        }
      />
    </div>
  );
}
