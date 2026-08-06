'use client';

import { useRef, type ReactNode } from 'react';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';
import {
  HiddenFileInput,
  type HiddenFileInputHandle,
} from '@/components/ui/hidden-file-input';

// ════════════════════════════════════════════════════════════════════════
// 인터뷰 카드 본문 — CD S1 프레젠테이션 공용 조각 (fresh build, BUILD-SPEC §1.1).
// 프레임/헤더밴드/툴바는 WidgetShell 소유. 여기는 헤더 아래 본문만: 컨트롤바 +
// 스크롤 영역 + 푸터 + mono 라벨/칩. 색·radius·shadow 는 파운데이션 승격 토큰
// (유틸), 비표준 border 폭(1.5/3px)·정밀 타이포는 인라인 스타일(.dc.html 관례).
// ════════════════════════════════════════════════════════════════════════

const INK = 'var(--color-ink)';
const LINE = 'var(--color-line)';

// ─── mono eyebrow (섹션 라벨 · "1 · 프로젝트", "업로드된 파일 · 8") ──────────
export function CardEyebrow({
  children,
  tone = 'mute',
}: {
  children: ReactNode;
  tone?: 'mute' | 'crimson';
}) {
  return (
    <div
      className={`font-mono-label font-bold uppercase ${
        tone === 'crimson' ? 'text-amore-deep' : 'text-mute-soft'
      }`}
      style={{ fontSize: 10, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
}

// ─── mono micro-chip (푸터 메타 "파일 8 · 블록 34 · KO", "READY" 요약 등) ─────
export function MonoChip({
  children,
  tone = 'ink',
}: {
  children: ReactNode;
  tone?: 'ink' | 'success';
}) {
  const cls =
    tone === 'success'
      ? 'bg-success-bg border-success-line text-success-text'
      : 'bg-paper border-line-strong text-ink';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-chip border font-mono-label font-bold ${cls}`}
      style={{ fontSize: 10.5, padding: '2px 8px' }}
    >
      {children}
    </span>
  );
}

// ─── 컨트롤바 (active 모드 공통, 1b–1e) — 프로젝트 pill + 우측 업로드 ─────────
export function CardControlBar({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2.5 bg-paper-soft"
      style={{ padding: '12px 22px', borderBottom: `1.5px solid ${LINE}` }}
    >
      {children}
    </div>
  );
}

// ─── 스크롤 본문 영역 (flex-1, 카드 프레임 안에서 세로 스크롤) ────────────────
export function CardScroll({
  children,
  gap = 14,
  className,
}: {
  children: ReactNode;
  gap?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${className ?? ''}`}
      style={{ padding: '18px 22px', gap }}
    >
      {children}
    </div>
  );
}

// ─── 푸터 바 (좌 mono note + 우 CTA) ─────────────────────────────────────────
export function CardFooter({
  note,
  cta,
}: {
  note: ReactNode;
  cta: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-between bg-paper"
      style={{
        padding: '15px 22px',
        borderTop: '1px solid var(--color-line-soft)',
      }}
    >
      <div
        className="font-mono-label text-mute-soft"
        style={{ fontSize: 11 }}
      >
        {note}
      </div>
      {cta}
    </div>
  );
}

// ─── 푸터 CTA — disabled(중립) / primary(ink solid). 클릭 = div role=button
//     (native <button> 금지 — forbid-elements). ────────────────────────────
export function CardFooterCta({
  label,
  trailing,
  onClick,
  disabled = false,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const base =
    'inline-flex items-center gap-2 rounded-pill font-bold select-none';
  if (disabled) {
    return (
      <span
        role="button"
        aria-disabled
        className={`${base} text-mute-soft`}
        style={{
          fontSize: 13.5,
          padding: '11px 20px',
          background: 'var(--color-surface-disabled)',
          border: '1.4px solid var(--color-line)',
          cursor: 'not-allowed',
        }}
      >
        {label}
        {trailing}
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`${base} bg-ink text-paper shadow-memphis-sm-faint cursor-pointer`}
      style={{ fontSize: 13.5, padding: '11px 20px', border: `1.4px solid ${INK}` }}
    >
      {label}
      {trailing}
    </span>
  );
}

// ─── 컨트롤바 프로젝트 pill 트리거 (DropdownMenu 트리거로 사용) ───────────────
// aria/onClick 는 DropdownMenu 가 주입. native <button> 대신 role=button div.
export function ProjectPillTrigger({
  name,
  open,
  onClick,
  ...aria
}: {
  name: string;
  open?: boolean;
  onClick?: () => void;
  [key: string]: unknown;
}) {
  return (
    <span
      {...aria}
      role="button"
      tabIndex={0}
      data-open={open}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="inline-flex min-w-0 items-center gap-2 rounded-pill bg-paper shadow-memphis-sm cursor-pointer"
      style={{ padding: '6px 13px', border: `1.5px solid ${INK}` }}
    >
      <DuotoneIcon name="project" size={15} />
      <span
        className="min-w-0 truncate font-bold text-ink"
        style={{ fontSize: 12.5 }}
      >
        {name}
      </span>
      <span aria-hidden className="text-ink" style={{ fontSize: 8 }}>
        ▼
      </span>
    </span>
  );
}

// ─── idle(1a) 대형 프로젝트 셀렉트 필드 (radius 22) ──────────────────────────
export function ProjectFieldTrigger({
  label,
  placeholder,
  open,
  onClick,
  ...aria
}: {
  label: string | null;
  placeholder: string;
  open?: boolean;
  onClick?: () => void;
  [key: string]: unknown;
}) {
  return (
    <span
      {...aria}
      role="button"
      tabIndex={0}
      data-open={open}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="flex w-full items-center gap-2.5 rounded-field bg-paper shadow-memphis-sm-faint cursor-pointer"
      style={{ padding: '13px 18px', border: `1.5px solid ${INK}` }}
    >
      <DuotoneIcon name="project" size={17} />
      <span
        className={`min-w-0 flex-1 truncate ${label ? 'font-bold text-ink' : 'text-faint'}`}
        style={{ fontSize: 13.5 }}
      >
        {label ?? placeholder}
      </span>
      <span aria-hidden className="text-ink" style={{ fontSize: 9 }}>
        ▼
      </span>
    </span>
  );
}

// ─── 우측 업로드 pill (컨트롤바) — 클릭 시 OS 파일 다이얼로그 → onFiles ───────
export function UploadPill({
  label,
  accept,
  maxSizeBytes,
  onFiles,
}: {
  label: string;
  accept?: string;
  maxSizeBytes?: number;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HiddenFileInputHandle>(null);
  const handle = (files: File[]) => {
    const ok = maxSizeBytes
      ? files.filter((f) => f.size <= maxSizeBytes)
      : files;
    if (ok.length > 0) onFiles(ok);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.open()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.open();
        }
      }}
      className="ml-auto inline-flex items-center gap-1.5 rounded-pill bg-paper font-bold text-ink shadow-memphis-sm-faint cursor-pointer"
      style={{ padding: '6px 13px', fontSize: 12, border: `1.5px solid ${INK}` }}
    >
      <DuotoneIcon name="upload" size={15} />
      {label}
      <HiddenFileInput
        ref={inputRef}
        accept={accept}
        multiple
        onFiles={handle}
      />
    </span>
  );
}
