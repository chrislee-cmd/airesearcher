'use client';

/* ────────────────────────────────────────────────────────────────────
   ParticipantCapture — 원격 AI UT 참가자(624) 공개 페이지 본문.

   무설치·무로그인. participant_token 링크로 진입한 익명 참가자가:
     1. 과제(task_goal)·대상 사이트 안내를 읽고
     2. 프라이버시 동의(필수 체크) 후
     3. "화면공유 1회" 로 세션을 시작 → 그 화면+음성이 LiveKit 으로 실시간
        발행되고(리서처 625 관전) 대상 사이트가 자기 브라우저 새 탭으로 열린다.
     4. 평소처럼 자유 사용 + think-aloud 발화. 최소 오버레이(녹화중/종료).

   캡처·발행·업로드 엔진은 useUtParticipantSession 가 소유. 이 컴포넌트는 UI 만.
   모든 카피는 messages(UtParticipant) — 디폴트(영어) 뷰 정합(한글 리터럴 가드 green).
   색/radius 는 design-system 토큰만.
   ──────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useUtParticipantSession } from '@/hooks/use-ut-participant-session';

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ParticipantCapture({
  token,
  taskGoal,
  targetUrl,
}: {
  token: string;
  taskGoal: string | null;
  targetUrl: string | null;
}) {
  const t = useTranslations('UtParticipant');
  const {
    phase,
    elapsedMs,
    error,
    isSupported,
    attachPreview,
    openTarget,
    start,
    stop,
  } = useUtParticipantSession({ token, targetUrl });
  const [agreed, setAgreed] = useState(false);

  // 대상 사이트 host 만 뽑아 안내(전체 URL 은 title 로). 실패 시 원문.
  let targetLabel = targetUrl ?? '';
  if (targetUrl) {
    try {
      targetLabel = new URL(targetUrl).host;
    } catch {
      targetLabel = targetUrl;
    }
  }

  const taskBlock = (
    <div className="rounded-sm border border-line bg-paper-soft p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-mute-soft">
        {t('task.heading')}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">
        {taskGoal && taskGoal.trim() ? taskGoal : t('task.noGoal')}
      </p>
      {targetUrl && (
        <p className="mt-3 text-sm text-mute">
          <span className="font-semibold text-ink-2">{t('task.targetLabel')}</span>{' '}
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={targetUrl}
            className="text-amore underline underline-offset-2"
          >
            {targetLabel}
          </a>
        </p>
      )}
    </div>
  );

  // ── unsupported ────────────────────────────────────────────────
  if (!isSupported) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
          {t('intro.heading')}
        </h1>
        <div className="mt-4 rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
          {t('unsupported')}
        </div>
      </Shell>
    );
  }

  // ── live ───────────────────────────────────────────────────────
  if (phase === 'live') {
    return (
      <Shell>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-warning">
            <span aria-hidden>🔴</span>
            {t('live.recording', { time: formatElapsed(elapsedMs) })}
          </span>
          <Button variant="secondary" size="sm" onClick={stop}>
            {t('live.end')}
          </Button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-mute">{t('live.hint')}</p>

        <div className="mt-4">{taskBlock}</div>

        <video
          ref={attachPreview}
          className="mt-4 aspect-video w-full rounded-xs border border-line-soft bg-ink"
          muted
          autoPlay
          playsInline
        />

        {targetUrl && (
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={openTarget}>
              {t('live.reopen')}
            </Button>
          </div>
        )}
      </Shell>
    );
  }

  // ── starting / ending ──────────────────────────────────────────
  if (phase === 'starting' || phase === 'ending') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
          {phase === 'starting' ? t('starting.heading') : t('ending.heading')}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-mute">
          {phase === 'starting' ? t('starting.body') : t('ending.body')}
        </p>
      </Shell>
    );
  }

  // ── ended ──────────────────────────────────────────────────────
  if (phase === 'ended') {
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            ✅
          </span>
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
            {t('ended.heading')}
          </h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-mute">{t('ended.body')}</p>
      </Shell>
    );
  }

  // ── consent (default) + error ──────────────────────────────────
  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
        {t('intro.heading')}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-mute">{t('intro.subtitle')}</p>

      <div className="mt-5">{taskBlock}</div>

      {/* 프라이버시 동의 게이트 — 필수. */}
      <div className="mt-5 flex flex-col gap-3">
        <div className="rounded-xs border-2 border-warning bg-paper-soft p-3 text-sm leading-relaxed text-ink-2">
          {t('consent.warning')}
        </div>
        <p className="text-xs leading-relaxed text-mute-soft">{t('consent.note')}</p>
        <label className="flex items-start gap-2 text-sm text-mute">
          <Checkbox
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-[3px]"
            aria-label={t('consent.checkbox')}
          />
          <span className="text-ink-2">{t('consent.checkbox')}</span>
        </label>
      </div>

      {phase === 'error' && error && (
        <div className="mt-4 rounded-xs border-2 border-warning bg-paper-soft px-3 py-2 text-sm text-ink-2">
          {error}
        </div>
      )}

      <div className="mt-6">
        <Button
          variant="primary"
          size="md"
          disabled={!agreed}
          onClick={() => void start()}
        >
          {t('consent.start')}
        </Button>
      </div>
    </Shell>
  );
}

// 공개 페이지 셸 — (app) 밖 독립 프레임. 중앙 정렬 단일 카드.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-4 pb-16 pt-10">
      <div className="rounded-md border border-line bg-paper p-6">{children}</div>
    </main>
  );
}
