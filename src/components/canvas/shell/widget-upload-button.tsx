/* ────────────────────────────────────────────────────────────────────
   WidgetUploadButton — canvas 위젯 서브헤더 좌측의 통일 "업로드" 트리거.

   WidgetSettingsButton 의 자매 primitive. 전사록 / 인터뷰 위젯이 옛
   대형 FileDropZone (~140px 상시 노출) 을 서브헤더에서 걷어내고, 좌측
   📤 업로드 아이콘 버튼 하나로 통일 — 클릭 시 dropzone 은 업로드 모달
   (WidgetUploadModal) 안으로 이동. 서브헤더 height 극단 ↓.

   시각: IconButton `bordered` (Memphis 2px ink border + hard shadow) md
   사이즈 — WidgetSettingsButton / 우측 CTA 와 같은 chrome 톤. 대기 중
   (큐) 파일이 있으면 우상단 amore count 배지로 명시.
   ──────────────────────────────────────────────────────────────────── */

import { IconButton } from '@/components/ui/icon-button';

// feather "upload" — 트레이 위로 화살표. 서브헤더 스케일에 맞춰 h-4 w-4.
function UploadIcon({ className }: { className?: string }) {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export type WidgetUploadButtonProps = {
  onClick: () => void;
  // 버튼 aria-label / tooltip. 한국어 default — 로케일 무관 위젯은 그대로,
  // i18n 필요한 호출부는 next-intl 값을 넘긴다.
  label?: string;
  // 대기 중 (큐) 파일 count. 0 이거나 미지정이면 배지 없음.
  count?: number;
  disabled?: boolean;
  // 아직 업로드 전 → amore halo pulse 로 "여기부터 눌러라" 유도 (§ 온보딩).
  // 파일이 들어오면 호출부가 false 로 내려 pulse 정지.
  pulse?: boolean;
};

export function WidgetUploadButton({
  onClick,
  label = '파일 업로드',
  count,
  disabled = false,
  pulse = false,
}: WidgetUploadButtonProps) {
  const showBadge = typeof count === 'number' && count > 0;
  return (
    // pulse halo 는 버튼 Memphis hard-shadow 를 덮지 않도록 wrapper span 에
    // 얹는다 (globals.css .widget-gate-guide-pulse).
    <span className={pulse ? 'inline-flex widget-gate-guide-pulse' : 'inline-flex'}>
      <IconButton
        variant="bordered"
        size="md"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="relative"
      >
        <UploadIcon className="h-4 w-4" />
        {showBadge && (
          <span
            className="absolute -right-1.5 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-amore px-1 text-xs font-semibold leading-none text-paper"
            aria-hidden
          >
            {count}
          </span>
        )}
      </IconButton>
    </span>
  );
}
