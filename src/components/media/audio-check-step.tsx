'use client';

/* ────────────────────────────────────────────────────────────────────
   AudioCheckStep — 오디오 캡처 "실측 신호" 게이트의 프레젠테이션.

   useAudioVerificationGate 의 상태를 받아 소스별(내 마이크 / 탭·시스템 오디오)
   라이브 VU 미터 + 상태 뱃지 + 실패별 정확한 CTA 를 그린다. "시작" 버튼은
   allVerified 전까지 disabled(숨김 아님 — 왜 막혔는지 미터로 보이게).

   - 마이크: "말해보세요" 유도. denied 면 브라우저 권한 재요청 문구.
   - 탭·시스템 오디오: 무음 판별이 어려우니 "🔊 테스트 사운드" 버튼 병행 +
     무음 감지 시 "다시 공유하기" CTA(탭 오디오 토글 꺼짐/네이티브 앱 회의).
   - enumerateDevices 마이크 드롭다운 — 잘못된 마이크면 즉시 교체(재취득 콜백).

   색/radius 는 design-system 토큰만. 카피는 messages(AudioCheck) — 4로케일.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { AudioGateState } from '@/hooks/use-audio-verification-gate';

type Props = {
  state: AudioGateState;
  /** 현재 선택된 마이크 deviceId(드롭다운 controlled 표시용). */
  selectedMicId?: string;
  /** 드롭다운으로 다른 마이크 선택 → 호출부가 그 deviceId 로 재취득. */
  onSelectDevice?: (deviceId: string) => void;
  /** 탭 무음 → 화면공유 픽커 재실행(다시 공유). */
  onRetryTab?: () => void;
  /** allVerified 상태에서 "시작". */
  onProceed: () => void;
  /** 게이트 취소(스트림 정리 후 이전 화면으로). */
  onCancel?: () => void;
  /** 게이트를 감싼 상위가 이미 카드 프레임이면 여백만. */
  className?: string;
  // ── 공유-주도 모드 (게이트가 화면공유까지 주도) ────────────────────────
  // 탭 오디오는 OS 공유 피커에서 "탭 오디오 공유"를 켜야만 측정 가능하다. 이
  // 모드에선 정적 안내 모달 대신 게이트가 "🔊 탭 공유" 버튼으로 피커를 띄우고,
  // 공유된 스트림의 라이브 레벨을 측정한다. shared 전엔 공유 버튼, 후엔 미터.
  /** true면 공유-주도 모드(공유 단계 → 미터 단계). */
  shareMode?: boolean;
  /** 공유(취득) 완료 여부 — false면 공유 버튼, true면 라이브 미터. */
  shared?: boolean;
  /** 공유(getDisplayMedia) 진행 중 — 버튼 busy. */
  sharing?: boolean;
  /** "🔊 탭 공유"/"다시 공유" → 호출부가 getDisplayMedia 를 (재)실행. */
  onShareTab?: () => void;
};

// 라이브 VU 미터 한 줄 — track + level fill + 상태 뱃지.
function MeterRow({
  label,
  level,
  verified,
  hint,
}: {
  label: string;
  level: number;
  verified: boolean;
  hint: string;
}) {
  const t = useTranslations('AudioCheck');
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span
          className={`rounded-pill border px-2 py-0.5 text-xs font-semibold ${
            verified
              ? 'border-success text-success'
              : level > 0.02
                ? 'border-line text-mute'
                : 'border-warning text-warning'
          }`}
        >
          {verified
            ? t('status.detected')
            : level > 0.02
              ? t('status.waiting')
              : t('status.noSignal')}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-pill border border-line bg-paper-soft">
        <div
          className={`h-full rounded-pill transition-[width] duration-75 ${
            verified ? 'bg-success' : 'bg-amore'
          }`}
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <p className="text-xs leading-snug text-mute-soft">{hint}</p>
    </div>
  );
}

export function AudioCheckStep({
  state,
  selectedMicId,
  onSelectDevice,
  onRetryTab,
  onProceed,
  onCancel,
  className,
  shareMode = false,
  shared = true,
  sharing = false,
  onShareTab,
}: Props) {
  const t = useTranslations('AudioCheck');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const testCtxRef = useRef<AudioContext | null>(null);

  // 마이크 장치 목록 — 권한 취득 후라야 label 이 채워진다(빈 값이면 index 폴백).
  useEffect(() => {
    if (!state.micActive) return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== 'function'
    ) {
      return;
    }
    let cancelled = false;
    const load = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (cancelled) return;
          setDevices(list.filter((d) => d.kind === 'audioinput'));
        })
        .catch(() => {});
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, [state.micActive]);

  // 테스트 사운드 — 짧은 가청 톤. 시스템/전체화면/같은 탭 오디오를 공유했다면
  // 이 소리가 탭 미터에 잡혀 verified 로 이어진다(회의가 무음일 때 능동 확인).
  // 다른 탭(회의 탭)만 공유한 경우엔 잡히지 않으므로 hint 로 한계를 안내한다.
  const playTestSound = useCallback(() => {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    try {
      testCtxRef.current?.close().catch(() => {});
    } catch {
      // 이전 컨텍스트 정리 실패 — 무시.
    }
    const ctx = new Ctx();
    testCtxRef.current = ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1.15);
    osc.onended = () => {
      void ctx.close().catch(() => {});
      if (testCtxRef.current === ctx) testCtxRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      void testCtxRef.current?.close().catch(() => {});
      testCtxRef.current = null;
    },
    [],
  );

  const micDenied = state.micActive && state.permissionState === 'denied';
  // 탭 무음 안내는 신호가 아직 확인 안 됐을 때만.
  const tabMuted = state.tabActive && !state.tabVerified;
  // 공유-주도 모드에서 아직 공유(취득) 전이면 미터 대신 공유 버튼 단계.
  const preShare = shareMode && !shared;
  // 탭 "다시 공유"는 공유-주도 모드에선 onShareTab, 아니면 onRetryTab.
  const retryTab = onShareTab ?? onRetryTab;

  return (
    <div className={`flex flex-col gap-4 ${className ?? ''}`}>
      <div className="flex flex-col gap-1">
        <h3 className="text-md font-semibold tracking-[-0.01em] text-ink">
          {t('heading')}
        </h3>
        <p className="text-sm leading-snug text-mute">
          {preShare ? t('share.subtitle') : t('subtitle')}
        </p>
      </div>

      {/* 공유-주도 모드 · 공유 전 — "🔊 탭 공유" 로 피커를 띄운다(정적 안내 대체). */}
      {preShare && (
        <div className="flex flex-col gap-3 rounded-sm border border-line bg-paper p-4">
          <p className="text-sm leading-snug text-mute">{t('share.instruction')}</p>
          <Button
            variant="primary"
            size="md"
            disabled={sharing}
            onClick={() => onShareTab?.()}
          >
            {sharing ? t('share.sharing') : t('share.cta')}
          </Button>
          <p className="text-xs leading-snug text-mute-soft">{t('share.hint')}</p>
        </div>
      )}

      {/* 마이크 소스 */}
      {!preShare && state.micActive && (
        <div className="flex flex-col gap-2 rounded-sm border border-line bg-paper p-3">
          <MeterRow
            label={t('mic.label')}
            level={state.micLevel}
            verified={state.micVerified}
            hint={micDenied ? t('mic.denied') : t('mic.hint')}
          />
          {devices.length > 1 && onSelectDevice && (
            <Select
              size="sm"
              label={t('mic.device')}
              value={selectedMicId ?? ''}
              onChange={(e) => onSelectDevice(e.target.value)}
              options={devices.map((d, i) => ({
                value: d.deviceId,
                label: d.label || t('mic.deviceFallback', { n: i + 1 }),
              }))}
            />
          )}
        </div>
      )}

      {/* 탭·시스템 오디오 소스 */}
      {!preShare && state.tabActive && (
        <div className="flex flex-col gap-2 rounded-sm border border-line bg-paper p-3">
          <MeterRow
            label={t('tab.label')}
            level={state.tabLevel}
            verified={state.tabVerified}
            hint={tabMuted ? t('tab.muted') : t('tab.hint')}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={playTestSound}>
              {t('tab.testSound')}
            </Button>
            {tabMuted && retryTab && (
              <Button
                variant="ghost"
                size="sm"
                disabled={sharing}
                onClick={() => retryTab()}
              >
                {sharing ? t('share.sharing') : t('tab.retry')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 게이트 CTA — allVerified 전까지 시작 disabled(숨김 아님). */}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!state.allVerified}
          onClick={onProceed}
        >
          {state.allVerified ? t('start') : t('verifying')}
        </Button>
      </div>
    </div>
  );
}
