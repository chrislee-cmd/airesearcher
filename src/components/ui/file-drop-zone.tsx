'use client';

import {
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';

export type FileDropZoneProps = {
  accept?: string;
  multiple?: boolean;
  maxSizeBytes?: number;
  onFiles: (files: File[]) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
  label?: ReactNode;
  helperText?: ReactNode;
  children?: ReactNode;
  className?: string;
  // Allow callers to handle non-file drops (e.g. workspace artifacts).
  // Return true to indicate the drop was consumed and the default
  // file-handling path should be skipped.
  onDropRaw?: (e: DragEvent<HTMLDivElement>) => boolean;
};

export function FileDropZone({
  accept,
  multiple = false,
  maxSizeBytes,
  onFiles,
  onError,
  disabled = false,
  label,
  helperText,
  children,
  className,
  onDropRaw,
  ...rest
}: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validate(files: File[]): File[] {
    if (!maxSizeBytes) return files;
    const ok: File[] = [];
    for (const f of files) {
      if (f.size > maxSizeBytes) {
        onError?.(`file_too_large:${f.name}`);
        continue;
      }
      ok.push(f);
    }
    return ok;
  }

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const arr = Array.from(list);
    const valid = validate(arr);
    if (valid.length > 0) onFiles(valid);
  }

  function openPicker() {
    if (disabled) return;
    inputRef.current?.click();
  }

  // PR-D15 — Memphis tone (shell pop 정합):
  // - 3px 검정 hard border (실선) + 6px radius + 3px offset 검정 shadow
  // - 흰 bg base · hover 시 옅은 노랑 wash · drag-over 시 핑크 accent border
  //   + offset shadow 살짝 확장 (4px) 로 "들고 있는" 감각 + 미세한 translate
  // - label 은 Outfit weight 700 검정 (지원 형식 라벨은 weight 500)
  const memphisBorder = dragOver
    ? 'var(--canvas-accent)'
    : 'var(--canvas-card-border)';
  const memphisShadow = dragOver
    ? '4px 4px 0 var(--canvas-card-border)'
    : 'var(--memphis-shadow-sm)';
  const memphisBg = dragOver
    ? 'var(--sidebar-nav-bg-hover)'
    : 'var(--sidebar-nav-bg)';
  const outfitStack = 'var(--font-outfit), var(--font-sans)';
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(false);
        if (onDropRaw && onDropRaw(e)) return;
        handleFiles(e.dataTransfer.files);
      }}
      onClick={openPicker}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPicker();
        }
      }}
      className={`flex flex-col items-center justify-center text-center transition-[transform,box-shadow,background-color,border-color] duration-[140ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--canvas-accent)] ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${dragOver ? '-translate-x-[1px] -translate-y-[1px]' : ''} ${className ?? ''}`}
      style={{
        background: memphisBg,
        border: `3px solid ${memphisBorder}`,
        borderRadius: 'var(--sidebar-nav-radius)',
        boxShadow: memphisShadow,
      }}
      {...rest}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {label !== undefined && (
        <div
          className="text-lg text-ink"
          style={{ fontFamily: outfitStack, fontWeight: 700, letterSpacing: '-0.005em' }}
        >
          {label}
        </div>
      )}
      {helperText !== undefined && (
        <div
          className="mt-2 text-sm text-ink-2"
          style={{ fontFamily: outfitStack, fontWeight: 500 }}
        >
          {helperText}
        </div>
      )}
      {children}
    </div>
  );
}
