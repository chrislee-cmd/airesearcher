'use client';

/* ────────────────────────────────────────────────────────────────────
   WidgetSettingsButton — canvas 위젯 서브헤더 좌측의 통일 "설정" 트리거.

   3 위젯 (데스크 / 동시통역 / 프로빙) 의 서브헤더가 필드 (캡처방식·언어·
   지역·기간·키워드·용어집·소스 등) 로 제각각 어수선했던 것을, 좌측 ⚙ 설정
   버튼 하나로 통일. 세부 필드는 클릭 시 WidgetSettingsModal 안으로 이동.

   시각: IconButton `bordered` (Memphis 2px ink border + hard shadow) md
   사이즈 — 우측 CTA 와 같은 chrome 톤. default 와 다른 값이 하나라도
   있으면 우상단 amore dot 으로 "설정됨" 을 명시 (hasChanges).
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { IconButton } from '@/components/ui/icon-button';

// feather "settings" gear — topbar-account 의 Gear 와 같은 path. 서브헤더
// 스케일에 맞춰 h-4 w-4 (16px) 로 렌더.
function SettingsGearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export type WidgetSettingsButtonProps = {
  onClick: () => void;
  // 버튼 aria-label / tooltip. 미지정 시 로케일 default(Shell.settings) —
  // desk / translate 등 커스텀 라벨이 필요한 호출부는 값을 넘긴다.
  label?: string;
  // default 와 다른 설정이 하나라도 있으면 우상단 amore dot 노출.
  hasChanges?: boolean;
  disabled?: boolean;
  // 설정 미완료 → CTA disabled 인 동안 amore halo pulse 로 "여기부터 눌러라"
  // 유도 (§ 온보딩). 설정이 채워지면 호출부가 false 로 내려 pulse 정지.
  pulse?: boolean;
};

export function WidgetSettingsButton({
  onClick,
  label,
  hasChanges = false,
  disabled = false,
  pulse = false,
}: WidgetSettingsButtonProps) {
  const t = useTranslations('Shell');
  const resolvedLabel = label ?? t('settings');
  return (
    // pulse halo 는 버튼 자체 Memphis hard-shadow 를 덮지 않도록 wrapper span
    // 에 얹는다 (globals.css .widget-gate-guide-pulse). pulse=false 여도
    // wrapper 는 유지 — 토글 시 IconButton 리마운트 방지 (DOM 안정).
    <span className={pulse ? 'inline-flex widget-gate-guide-pulse' : 'inline-flex'}>
      <IconButton
        variant="bordered"
        size="md"
        onClick={onClick}
        disabled={disabled}
        aria-label={resolvedLabel}
        title={resolvedLabel}
        className="relative"
      >
        <SettingsGearIcon className="h-4 w-4" />
        {hasChanges && (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amore"
            aria-hidden
          />
        )}
      </IconButton>
    </span>
  );
}
