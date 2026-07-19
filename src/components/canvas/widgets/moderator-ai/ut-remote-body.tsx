'use client';

/* ────────────────────────────────────────────────────────────────────
   UtRemoteBody — AI UT 원격 모드(리서처 오케스트레이션/모니터) 표면.

   흐름(세팅·생성은 상위 세팅 아코디언·CTA 가 담당 — V2 U1): 세션 생성 후
   participant_url 발급 + 참가자 대기(waiting, 공유 인플레이스) → 참가자 화면
   라이브 관전(live) → 참가자 종료 후 사후 리뷰(review, 녹화·전사 다운로드는
   로컬과 동일 UtResultView 재사용). idle/생성 폼은 이 컴포넌트에 없다 —
   부모(UtSessionBody)의 UtSetupAccordion 이 소유.

   프레임은 ControlBoardPanel 슬롯 계약 — 색/radius 는 design-system 토큰만,
   임의 layout 클래스 금지. 라이브 관전 <video> 는 현재 보이는 단일 표면에만
   렌더(스트림 단일 부착) — 로컬 프리뷰와 동형.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { ChromeInput } from '@/components/ui/chrome-input';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { ControlBoardPanel } from '@/components/canvas/shell/control-board-panel';
import { UtResultView } from './ut-result';
import type { UseUtRemoteSession } from './use-ut-remote-session';
import type {
  UtCaptionLine,
  UtLiveCaptionStatus,
} from './use-ut-live-caption';

// 듀오톤 아이콘 채움 = peach(스펙 §4) — 세팅/공유 톤 통일. 하드코딩 hex 0.
const PEACH_FILL = 'var(--widget-header-bg-peach)';

type Props = {
  remote: UseUtRemoteSession;
  // 라이브 관전 <video> ref 콜백 — 별도 prop 으로 받는다. `remote.attachMonitor`
  // 를 직접 `ref=` 에 쓰면 react-hooks/refs 가 `remote` 전체를 ref 로 오인해
  // 모든 `remote.*` 접근을 render-중-ref-접근으로 잘못 잡는다(prop 경유 hook
  // 반환의 한계). 직접 hook 을 호출하는 부모에서 넘겨주면 그 오인이 사라진다.
  attachMonitor: (el: HTMLVideoElement | null) => void;
  isActiveSurface: boolean;
};

// 라이브 캡션(634/637) — 모더 관전 중 참여자 발화 실시간 자막. 화면 <video> 와
// 동시 가시("화면+대화 같이"). VAD 세그먼트를 **줄마다 끊지 않고 흐르는 문단
// (rolling transcript)** 으로 이어 그린다 — 확정(final) 세그먼트는 확정색
// (text-ink), 진행 중(interim) tail 은 흐리게(text-mute-soft) 이어붙어, 미세
// pause 로 세그먼트가 나뉘어도 화면은 연속 텍스트로 흐른다(637 파편화 체감 완화).
// 새 텍스트마다 하단 자동 스크롤. 롤링 cap 은 훅의 LINE_CAP 이 유지. STT 실패/
// 미시작(error/idle) 시 영역 자체를 숨겨 관전 화면을 건드리지 않는다(graceful).
function UtLiveCaptions({
  lines,
  status,
}: {
  lines: UtCaptionLine[];
  status: UtLiveCaptionStatus;
}) {
  const t = useTranslations('AiUt');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (status !== 'connecting' && status !== 'live') return null;

  return (
    <ControlBoardPanel.Region label={t('remote.live.captionLabel')}>
      <div
        ref={scrollRef}
        className="max-h-32 overflow-y-auto rounded-xs border border-line-soft bg-paper-soft px-3 py-2"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <p className="text-sm text-mute-soft">
            {t('remote.live.captionWaiting')}
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-ink">
            {lines.map((l, i) => (
              <span
                key={l.id}
                className={l.final ? 'text-ink' : 'text-mute-soft'}
              >
                {i > 0 ? ' ' : ''}
                {l.text}
              </span>
            ))}
          </p>
        )}
      </div>
    </ControlBoardPanel.Region>
  );
}

export function UtRemoteBody({
  remote,
  attachMonitor,
  isActiveSurface,
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
          <UtLiveCaptions
            lines={remote.captionLines}
            status={remote.captionStatus}
          />
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
            <div className="flex items-center gap-2 rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
              <DuotoneIcon name="waiting" size={18} fill={PEACH_FILL} />
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

  // 도달 불가(idle/creating/error 는 상위 세팅 아코디언·CTA 가 소유). 타입
  // exhaustiveness 를 위한 폴백 — 렌더 없음.
  return null;
}
