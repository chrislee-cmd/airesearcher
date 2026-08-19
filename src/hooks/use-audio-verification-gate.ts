'use client';

/* ────────────────────────────────────────────────────────────────────
   useAudioVerificationGate — 브라우저 오디오 캡처 "실측 신호" 게이트.

   재프레이밍(스펙 SSOT): 참가자가 브라우저로 참여했는지·"탭 오디오 공유"를
   켰는지·마이크가 음소거인지는 직접 introspect 할 수 없다. 하지만 우리가 진짜
   원하는 건 **오디오가 실제로 흐르는가**이고, 그건 AudioContext + AnalyserNode
   로 **측정 가능**하다. 네이티브 앱 / 토글 꺼짐 / 마이크 음소거 / 엉뚱한 탭
   공유 등 모든 실패는 "레벨 미터가 안 움직인다" 하나로 수렴한다 → 측정된
   신호가 확인돼야만 호출부가 "시작"을 연다.

   입력: 이미 취득된 스트림(micStream / tabStream)과 무엇을 요구하는지(require).
   각 스트림의 오디오 트랙을 AnalyserNode 에 물려 rAF 루프로 RMS 를 샘플링하고,
   임계값 초과를 **최근 N초 창(래치)** 으로 판정한다 — 잠깐 조용해도 verified 가
   바로 풀리지 않아 오탐을 막는다. 언마운트/스트림 교체 시 AudioContext.close()
   + rAF 취소로 확실히 정리(다중 세션 진입 시 누수 금지).

   이 훅은 UI 를 그리지 않는다 — 프레젠테이션은 AudioCheckStep 가 소비한다.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';

// ── 튜닝 상수 (보수적) ────────────────────────────────────────────────
// RMS(0..1) 임계값. 사람 발화 RMS 는 대략 0.05~0.2, 방 소음/팬 노이즈는
// 그보다 훨씬 작다 — 0.015 는 "누군가 말했거나 회의 소리가 흘렀다"를 잡되
// 배경 잡음 한 방울로 verified 되지 않게 하는 보수적 지점.
const ENERGY_THRESHOLD = 0.015;
// 임계값 초과를 관측한 뒤 verified 를 유지하는 창(ms). 스펙 기본 ~1.5s 에
// "시작" 클릭까지의 여유를 더해 2s — 발화 사이 자연스러운 무음으로 게이트가
// 깜빡이지 않게 한다(오탐 방지). 이보다 오래 완전 무음이면 verified 해제.
const VERIFY_HOLD_MS = 2000;
// VU 미터 표시용 게인 — RMS 를 0..1 미터 눈금으로 확대(발화가 바 절반 이상을
// 채우도록). 판정(ENERGY_THRESHOLD)에는 raw RMS 를 쓰고, 이 게인은 표시 전용.
const METER_GAIN = 6;

export type AudioPermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unsupported';

export type AudioGateRequire = { mic?: boolean; tabAudio?: boolean };

export type UseAudioVerificationGateInput = {
  require: AudioGateRequire;
  micStream?: MediaStream | null;
  tabStream?: MediaStream | null;
};

export type AudioGateState = {
  /** 표시용 레벨 0..1 (요구하지 않는 소스는 항상 0). */
  micLevel: number;
  tabLevel: number;
  /** 최근 창 안에 임계값 초과 신호를 관측했는가. 요구 안 하면 항상 true. */
  micVerified: boolean;
  tabVerified: boolean;
  /** 요구된 모든 소스가 verified. 호출부의 "시작" 게이트. */
  allVerified: boolean;
  /** 이 소스를 실제로 요구하는가(=미터/뱃지를 그릴지). */
  micActive: boolean;
  tabActive: boolean;
  /** 마이크 권한 상태(문구 보조용 — 판정 1차 근거는 에너지 측정). */
  permissionState: AudioPermissionState;
};

// getFloatTimeDomainData 로 프레임의 RMS(0..1) 계산.
function rms(buf: Float32Array<ArrayBuffer>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

export function useAudioVerificationGate({
  require,
  micStream = null,
  tabStream = null,
}: UseAudioVerificationGateInput): AudioGateState {
  const requireMic = !!require.mic;
  const requireTab = !!require.tabAudio;

  const [micLevel, setMicLevel] = useState(0);
  const [tabLevel, setTabLevel] = useState(0);
  // 측정 판정(raw) — 요구하지 않는 소스는 return 에서 true 로 덮는다(파생).
  const [micVerified, setMicVerified] = useState(false);
  const [tabVerified, setTabVerified] = useState(false);
  const [permissionState, setPermissionState] =
    useState<AudioPermissionState>('unsupported');

  // ── 마이크 권한 상태 조회(문구 보조). permissions.query 미지원(사파리 일부)
  //    이면 'unsupported' 폴백 — 게이트는 에너지 측정이 1차 근거라 무영향. ──
  useEffect(() => {
    if (!requireMic) return;
    if (
      typeof navigator === 'undefined' ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== 'function'
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- capability fallback: permissions.query 미지원(사파리 일부) 확정 시 1회 unsupported 로 고정(측정 게이트엔 무영향)
      setPermissionState('unsupported');
      return;
    }
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status && !cancelled) {
        setPermissionState(status.state as AudioPermissionState);
      }
    };
    navigator.permissions
      // 'microphone' 은 표준 PermissionName 유니온에 아직 없어 캐스팅.
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setPermissionState(s.state as AudioPermissionState);
        s.addEventListener('change', onChange);
      })
      .catch(() => {
        if (!cancelled) setPermissionState('unsupported');
      });
    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, [requireMic]);

  // ── 측정 루프. mic/tab 스트림(또는 요구 조건) 이 바뀔 때마다 그래프 재구성.
  //    rAF 는 1개로 두 소스를 함께 처리(스펙: 미터는 rAF 1개). ──
  useEffect(() => {
    const activeMic = requireMic ? micStream : null;
    const activeTab = requireTab ? tabStream : null;
    if (!activeMic && !activeTab) return;

    const Ctx =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined;
    if (!Ctx) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctx();
    } catch {
      return;
    }
    // 게이트는 사용자 제스처(마이크/화면 권한 클릭) 직후 마운트되므로 대개
    // running. suspended 면 resume 시도(autoplay 정책).
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

    type Node = {
      analyser: AnalyserNode;
      buf: Float32Array<ArrayBuffer>;
      source: MediaStreamAudioSourceNode;
      lastAbove: number | null;
      tracks: MediaStreamTrack[];
      onDead: () => void;
    };

    const build = (stream: MediaStream): Node | null => {
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) return null;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const buf = new Float32Array(analyser.fftSize);
      // 분석 전용 새 MediaStream 으로 물려 원본 파이프라인에 간섭하지 않는다.
      const source = ctx.createMediaStreamSource(new MediaStream(tracks));
      source.connect(analyser);
      const node: Node = {
        analyser,
        buf,
        source,
        lastAbove: null,
        tracks,
        onDead: () => {
          // 트랙이 죽거나(공유 중지) 음소거되면 즉시 verified 근거를 무효화.
          node.lastAbove = null;
        },
      };
      tracks.forEach((tr) => {
        tr.addEventListener('ended', node.onDead);
        tr.addEventListener('mute', node.onDead);
      });
      return node;
    };

    const micNode = activeMic ? build(activeMic) : null;
    const tabNode = activeTab ? build(activeTab) : null;

    let raf = 0;
    let stopped = false;

    const sample = (node: Node | null): { level: number; verified: boolean } => {
      if (!node) return { level: 0, verified: false };
      node.analyser.getFloatTimeDomainData(node.buf);
      const energy = rms(node.buf);
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (energy >= ENERGY_THRESHOLD) node.lastAbove = now;
      const verified =
        node.lastAbove != null && now - node.lastAbove < VERIFY_HOLD_MS;
      const level = Math.min(1, energy * METER_GAIN);
      return { level, verified };
    };

    const loop = () => {
      if (stopped) return;
      const m = sample(micNode);
      const tb = sample(tabNode);
      if (micNode) {
        setMicLevel(m.level);
        setMicVerified(m.verified);
      }
      if (tabNode) {
        setTabLevel(tb.level);
        setTabVerified(tb.verified);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      for (const node of [micNode, tabNode]) {
        if (!node) continue;
        node.tracks.forEach((tr) => {
          tr.removeEventListener('ended', node.onDead);
          tr.removeEventListener('mute', node.onDead);
        });
        try {
          node.source.disconnect();
          node.analyser.disconnect();
        } catch {
          // 이미 정리됨 — 무시.
        }
      }
      void ctx.close().catch(() => {});
      // 스트림이 사라지면 미터/판정을 초기 상태로.
      if (requireMic) setMicVerified(false);
      if (requireTab) setTabVerified(false);
      setMicLevel(0);
      setTabLevel(0);
    };
  }, [requireMic, requireTab, micStream, tabStream]);

  const allVerified =
    (!requireMic || micVerified) && (!requireTab || tabVerified);

  return {
    micLevel: requireMic ? micLevel : 0,
    tabLevel: requireTab ? tabLevel : 0,
    micVerified: requireMic ? micVerified : true,
    tabVerified: requireTab ? tabVerified : true,
    allVerified,
    micActive: requireMic,
    tabActive: requireTab,
    permissionState,
  };
}
