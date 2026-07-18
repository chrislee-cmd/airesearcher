'use client';

/* ────────────────────────────────────────────────────────────────────
   PersonaPanel — probing 좌패널 8 패널 그리드의 단일 카드.

   ReflectionPane 가 8 PersonaPanel 을 2×4 (lg) / 1×8 (좁을 때) 로
   배치한다. 각 패널은 summary + signals + confidence 를 표시.

   - confidence='insufficient' → 패널은 빈 placeholder 톤 (점선 border
     없이 dimmed body — 아직 단서가 모이지 않았다는 의도 표시).
   - 그 외엔 Memphis 박스 (token 기반 border + shadow). summary 본문
     강조, signals 는 bullet list. quote 가 있는 신호는 italic 보조줄.

   확장성: 후속 PR 에서 패널 클릭 시 expand / drag / send-to 등이 붙으면
   여기에 추가. 현재는 순수 표시.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import type { ProbingPersonaSection } from '@/lib/probing-prompts';
import { IconButton } from '@/components/ui/icon-button';

const panelStyle = {
  border: '2px solid var(--canvas-card-border)',
  borderRadius: 'var(--sidebar-nav-radius)',
  boxShadow: 'var(--memphis-shadow-xs)',
} as const;

const insufficientStyle = {
  border: '2px dashed var(--color-line)',
  borderRadius: 'var(--sidebar-nav-radius)',
} as const;

// 모순(⚠) 인라인 행 — warning 톤 박스. 기존 panelStyle 처럼 인라인 style 로
// 토큰 참조(className bracket 아님 → DS-6 bracket 게이트 무관).
const conflictRowStyle = {
  border: '2px solid var(--color-warning)',
  borderRadius: 'var(--sidebar-nav-radius)',
} as const;

type Confidence = ProbingPersonaSection['confidence'];

function ConfidenceDot({ confidence }: { confidence: Confidence }) {
  const t = useTranslations('Widgets');
  const label =
    confidence === 'high'
      ? t('probingConfidenceHigh')
      : confidence === 'medium'
        ? t('probingConfidenceMedium')
        : confidence === 'low'
          ? t('probingConfidenceLow')
          : t('probingConfidenceInsufficient');
  const cls =
    confidence === 'high'
      ? 'text-success'
      : confidence === 'medium'
        ? 'text-warning'
        : confidence === 'low'
          ? 'text-mute'
          : 'text-mute-soft';
  const glyph =
    confidence === 'high'
      ? '●●●'
      : confidence === 'medium'
        ? '●●○'
        : confidence === 'low'
          ? '●○○'
          : '○○○';
  return (
    <span
      className={`text-xs leading-none tracking-tight ${cls}`}
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
  highlight = false,
}: {
  icon: string;
  title: string;
  section: ProbingPersonaSection | null;
  // 우측 상단 × 버튼 노출 콜백. custom 섹션은 정의 자체를 영구 삭제
  // (useCustomSections.remove), 기본 8 섹션은 UI 숨김 (useHiddenDefaults.hide
  // — PR: probing-default-persona-widgets-hide) 을 연결한다. undefined 면 ×
  // 미노출. aria-label 은 "위젯 제거" 로 두 경우를 공통 표현.
  onRemove?: () => void;
  // 주입/추가로 방금 생성된 위젯 — 마운트 시 ephemeral 엔트런스 애니메이션
  // (probing-widget-added) 을 1회 재생. 몇 초 뒤 부모가 false 로 되돌린다.
  highlight?: boolean;
}) {
  const t = useTranslations('Widgets');
  const confidence: Confidence = section?.confidence ?? 'insufficient';
  const summary = section?.summary?.trim() ?? '';
  const signals = (section?.signals ?? []).filter(
    (s) => typeof s?.bullet === 'string' && s.bullet.trim().length > 0,
  );
  // 모순 쌍(⚠) — prior/current 중 하나라도 내용 있는 것만. 있으면 패널은
  // insufficient 로 떨구지 않는다(모순은 곧 채워진 내용이 있다는 뜻).
  const conflicts = (section?.conflicts ?? []).filter(
    (c) =>
      (c?.prior?.trim().length ?? 0) > 0 ||
      (c?.current?.trim().length ?? 0) > 0,
  );
  const hasConflict = conflicts.length > 0;
  const isInsufficient =
    !hasConflict &&
    (confidence === 'insufficient' ||
      (summary.length === 0 && signals.length === 0));

  return (
    <section
      className={`flex min-h-[120px] flex-col gap-2 bg-paper p-3${
        highlight ? ' probing-widget-added' : ''
      }`}
      style={isInsufficient ? insufficientStyle : panelStyle}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="text-lg leading-none">
            {icon}
          </span>
          <h4 className="truncate text-xs uppercase tracking-[0.22em] text-mute-soft">
            {title}
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasConflict && (
            <span
              className="text-xs leading-none text-warning"
              aria-label={t('probingConflictBadge')}
              title={t('probingConflictBadge')}
            >
              ⚠
            </span>
          )}
          <ConfidenceDot confidence={confidence} />
          {onRemove && (
            <IconButton
              variant="ghost-danger"
              onClick={onRemove}
              aria-label={t('probingRemoveWidget', { title })}
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
          {t('probingInsufficientHint')}
        </p>
      ) : (
        <>
          {summary.length > 0 && (
            <p className="text-sm font-medium leading-snug text-ink-2">
              {summary}
            </p>
          )}
          {/* 모순(⚠) 인라인 — '이전 ↔ 현재' 쌍. 이전값 흐리게+취소선, 현재값
              강조. 기존 값은 지우지 않고(누락 0) 충돌만 가시화. */}
          {hasConflict && (
            <ul className="flex flex-col gap-1.5">
              {conflicts.map((c, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-0.5 bg-paper px-2 py-1.5"
                  style={conflictRowStyle}
                >
                  <div className="flex items-center gap-1">
                    <span aria-hidden className="text-xs leading-none text-warning">
                      ⚠
                    </span>
                    {c.field?.trim() && (
                      <span className="text-xs uppercase tracking-[0.14em] text-warning">
                        {c.field.trim()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-snug text-mute">
                    <span className="text-mute-soft">{t('probingPrior')}:</span>{' '}
                    <span className="text-mute-soft line-through">
                      {c.prior.trim()}
                    </span>
                    <span aria-hidden className="px-1 text-mute-soft">
                      ↔
                    </span>
                    <span className="text-mute-soft">{t('probingCurrent')}:</span>{' '}
                    <span className="font-medium text-ink-2">
                      {c.current.trim()}
                    </span>
                  </p>
                  {c.note?.trim() && (
                    <p className="text-xs italic leading-snug text-mute-soft">
                      {c.note.trim()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {signals.length > 0 && (
            <ul className="flex flex-col gap-1">
              {signals.map((s, i) => (
                <li
                  key={i}
                  className="text-xs leading-snug text-mute"
                >
                  <span className="text-ink-2">·</span> {s.bullet}
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
