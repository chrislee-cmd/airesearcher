'use client';

/* ────────────────────────────────────────────────────────────────────
   PersonaPanel — probing 좌패널 8 패널 그리드의 단일 카드.

   ReflectionPane 가 8 PersonaPanel 을 2×4 (lg) / 1×8 (좁을 때) 로
   배치한다. 각 패널은 summary + signals + confidence 를 표시.

   - confidence='insufficient' → 패널은 빈 placeholder 톤 (점선 border +
     dimmed body — 아직 단서가 모이지 않았다는 의도 표시).
   - 그 외엔 editorial 박스 (얇은 1px border, shadow 없음 — §9). summary
     본문 강조, signals 는 bullet list. quote 가 있는 신호는 italic 보조줄.
     신뢰도는 단색 dot 1개 (의미는 title/aria 로 보존).

   확장성: 후속 PR 에서 패널 클릭 시 expand / drag / send-to 등이 붙으면
   여기에 추가. 현재는 순수 표시.
   ──────────────────────────────────────────────────────────────────── */

import type { ProbingPersonaSection } from '@/lib/probing-prompts';
import { IconButton } from '@/components/ui/icon-button';

// §9 editorial: 9패널 그리드라 카드 크롬이 ×9 로 쌓여 무거움. 2px+memphis-shadow
// → 얇은 1px border + shadow 제거. active(solid)/insufficient(dashed) 구분은
// 유지하되 둘 다 더 조용하게 (color-line 계열, 그림자 없음).
const panelStyle = {
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--sidebar-nav-radius)',
} as const;

const insufficientStyle = {
  border: '1px dashed var(--color-line-soft)',
  borderRadius: 'var(--sidebar-nav-radius)',
} as const;

type Confidence = ProbingPersonaSection['confidence'];

function ConfidenceDot({ confidence }: { confidence: Confidence }) {
  const label =
    confidence === 'high'
      ? '신호 강함'
      : confidence === 'medium'
        ? '신호 보통'
        : confidence === 'low'
          ? '신호 약함'
          : '단서 부족';
  const cls =
    confidence === 'high'
      ? 'text-success'
      : confidence === 'medium'
        ? 'text-warning'
        : confidence === 'low'
          ? 'text-mute'
          : 'text-mute-soft';
  // 9장 반복 시 3-글리프 점 그리드가 시각 노이즈 → 단색 dot 1개로 축소.
  // 강/보통/약/부족 의미는 색 + label(title/aria) 로 보존.
  const glyph = confidence === 'insufficient' ? '○' : '●';
  return (
    <span
      className={`text-xs leading-none ${cls}`}
      aria-label={label}
      title={label}
    >
      {glyph}
    </span>
  );
}

export function PersonaPanel({
  icon,
  title,
  section,
  onRemove,
}: {
  icon: string;
  title: string;
  section: ProbingPersonaSection | null;
  // 우측 상단 × 버튼 노출 콜백. custom 섹션은 정의 자체를 영구 삭제
  // (useCustomSections.remove), 기본 8 섹션은 UI 숨김 (useHiddenDefaults.hide
  // — PR: probing-default-persona-widgets-hide) 을 연결한다. undefined 면 ×
  // 미노출. aria-label 은 "위젯 제거" 로 두 경우를 공통 표현.
  onRemove?: () => void;
}) {
  const confidence: Confidence = section?.confidence ?? 'insufficient';
  const summary = section?.summary?.trim() ?? '';
  const signals = (section?.signals ?? []).filter(
    (s) => typeof s?.bullet === 'string' && s.bullet.trim().length > 0,
  );
  const isInsufficient =
    confidence === 'insufficient' || (summary.length === 0 && signals.length === 0);

  return (
    <section
      className="flex min-h-[120px] flex-col gap-2 bg-paper p-3"
      style={isInsufficient ? insufficientStyle : panelStyle}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="text-lg leading-none">
            {icon}
          </span>
          <h4 className="truncate text-xs uppercase tracking-wider text-mute-soft">
            {title}
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ConfidenceDot confidence={confidence} />
          {onRemove && (
            <IconButton
              variant="ghost-danger"
              onClick={onRemove}
              aria-label={`위젯 제거: ${title}`}
              // 인터랙션 전용 — PDF 캡쳐 (페르소나 grid) 에서는 제외.
              data-export-hide
            >
              ×
            </IconButton>
          )}
        </div>
      </header>

      {isInsufficient ? (
        <p className="text-xs italic text-mute-soft leading-snug">
          단서 부족 — 발화 누적 후 표시
        </p>
      ) : (
        <>
          {summary.length > 0 && (
            <p className="text-sm font-medium leading-snug text-ink-2">
              {summary}
            </p>
          )}
          {signals.length > 0 && (
            <ul className="flex flex-col gap-1">
              {signals.map((s, i) => (
                <li
                  key={i}
                  className="text-xs leading-snug text-mute"
                >
                  <span aria-hidden className="text-mute-soft">·</span> {s.bullet}
                  {s.quote && s.quote.trim().length > 0 && (
                    <span className="mt-0.5 block pl-2 italic text-mute-soft">
                      &ldquo;{s.quote.trim()}&rdquo;
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
