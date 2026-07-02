'use client';

/* ────────────────────────────────────────────────────────────────────
   ReflectionPane — probing 위젯 좌패널 (PR: probing-persona-panels).

   초기 PR (probing-two-pane-reflection) 의 3 섹션 markdown bullet 표시
   를 **페르소나 한판 8 패널 그리드** 로 재편. 각 패널 = PersonaPanel
   primitive. transcript 가 빈약한 섹션은 confidence='insufficient' 의
   placeholder 톤으로 의도된 빈 칸임을 시각화.

   생성 / 갱신 트리거 / 데이터는 부모 (probing-card.tsx) 가 소유. 이
   컴포넌트는 순수 표시 + "지금 갱신" 액션만 노출.
   ──────────────────────────────────────────────────────────────────── */

import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/canvas/shell/widget-outputs';
import type {
  ProbingPersona,
  ProbingPersonaSection,
  ProbingPersonaSectionKey,
} from '@/lib/probing-prompts';
import type { ProbingCustomSection } from '../probing-types';
import { PersonaPanel } from './persona-panel';

// 위젯 전반 (probing-card.tsx 등) 에서 동일 타입을 import 하므로 그대로 export.
export type ProbingReflectionData = Partial<ProbingPersona>;

export type ReflectionStatus = 'idle' | 'streaming' | 'ready' | 'error';

type PanelConfig = {
  key: ProbingPersonaSectionKey;
  icon: string;
  title: string;
};

// 그리드 순서 — 사용자 인지 흐름 (정체성 → 가치관 → 선호 → 욕구 → 행동) 에
// 맞춰 demographics 부터 시작하고 behavioral_patterns 로 마무리. 8 패널이라
// 2×4 (lg) / 1×8 (좁을 때) 자동 wrap.
const PANELS: PanelConfig[] = [
  { key: 'demographics', icon: '👤', title: '데모그래픽' },
  { key: 'values', icon: '🌱', title: '가치관' },
  { key: 'preferences', icon: '💎', title: '선호' },
  { key: 'needs', icon: '🎯', title: '니즈' },
  { key: 'painpoints', icon: '⚠️', title: '페인포인트' },
  { key: 'brand_perception', icon: '🏷️', title: '브랜드 인식' },
  { key: 'decision_drivers', icon: '🧭', title: '의사결정 요인' },
  { key: 'behavioral_patterns', icon: '🔁', title: '행동 패턴' },
];

const memphisPlaceholderStyle = {
  border: '2px solid var(--canvas-card-border)',
  borderRadius: 'var(--sidebar-nav-radius)',
  boxShadow: 'var(--memphis-shadow-xs)',
} as const;

function formatRelativeKo(epochMs: number | null, nowMs: number): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return '';
  const diff = Math.max(0, nowMs - epochMs);
  if (diff < 30_000) return '방금 전 갱신';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}분 전 갱신`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}시간 전 갱신`;
  return `${Math.floor(diff / 86_400_000)}일 전 갱신`;
}

function sectionOrNull(
  data: ProbingReflectionData | null,
  key: string,
): ProbingPersonaSection | null {
  if (!data) return null;
  const v = (data as Record<string, ProbingPersonaSection | undefined>)[key];
  if (!v || typeof v !== 'object') return null;
  return v as ProbingPersonaSection;
}

export function ReflectionPane({
  data,
  status,
  lastUpdatedAt,
  nowMs,
  error,
  canRefresh,
  onRefresh,
  isLive,
  hasTranscript,
  customSections,
  onRemoveCustomSection,
}: {
  data: ProbingReflectionData | null;
  status: ReflectionStatus;
  lastUpdatedAt: number | null;
  nowMs: number;
  error: string | null;
  canRefresh: boolean;
  onRefresh: () => void;
  isLive: boolean;
  hasTranscript: boolean;
  // custom 섹션 (PR: probing-custom-section-ui) — 기본 8 패널 뒤에 append.
  customSections: ProbingCustomSection[];
  onRemoveCustomSection: (key: string) => void;
}) {
  const stamp = formatRelativeKo(lastUpdatedAt, nowMs);
  const headerLabel =
    status === 'streaming'
      ? '갱신 중…'
      : stamp || (status === 'error' ? '갱신 실패' : '대기 중');

  // data 가 있으면 그리드 표시. partial 스트림 동안에는 일부 섹션이 아직 빈
  // 객체일 수 있는데 sectionOrNull 가 그 경우 insufficient placeholder 로 떨군다.
  const hasAnyPanelData = data !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SectionLabel>응답자 페르소나</SectionLabel>
          <span className="text-xs text-mute-soft">· {headerLabel}</span>
        </div>
        <Button
          variant="secondary"
          size="xs"
          onClick={onRefresh}
          disabled={!canRefresh}
          loading={status === 'streaming'}
          loadingLabel="갱신 중…"
          className="uppercase tracking-[0.18em]"
        >
          지금 갱신
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {hasAnyPanelData ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {PANELS.map((p) => (
              <PersonaPanel
                key={p.key}
                icon={p.icon}
                title={p.title}
                section={sectionOrNull(data, p.key)}
              />
            ))}
            {customSections.map((c) => (
              <PersonaPanel
                key={c.key}
                icon="🧩"
                title={c.title}
                section={sectionOrNull(data, c.key)}
                onRemove={() => onRemoveCustomSection(c.key)}
              />
            ))}
          </div>
        ) : status === 'streaming' ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            페르소나 분석 생성 중…
          </div>
        ) : !isLive ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            세션을 시작하면 발화에서 응답자 페르소나가 8 패널로 정리됩니다.
          </div>
        ) : !hasTranscript ? (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            transcript 가 들어오면 첫 페르소나 한판이 표시됩니다.
          </div>
        ) : (
          <div
            className="bg-paper px-4 py-6 text-center text-md text-ink-2"
            style={memphisPlaceholderStyle}
          >
            발화가 더 모이면 자동으로 페르소나가 갱신됩니다.
            <br />
            &lsquo;지금 갱신&rsquo; 으로 즉시 시도할 수도 있어요.
          </div>
        )}

        {error && (
          <div
            className="mt-3 bg-paper px-3 py-2 text-sm text-warning"
            style={{
              border: '2px solid var(--color-warning)',
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: '2px 2px 0 var(--color-warning)',
            }}
          >
            페르소나 생성 실패: {error}
          </div>
        )}
      </div>
    </div>
  );
}
