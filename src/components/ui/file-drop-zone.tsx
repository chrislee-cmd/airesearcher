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
  'data-coach'?: string;
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
      className={`flex flex-col items-center justify-center border bg-paper text-center transition-colors duration-[120ms] [border-radius:4px] ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${
        dragOver
          ? 'border-ink'
          : 'border-dashed border-line hover:border-mute-soft'
      } ${className ?? ''}`}
      style={{ borderStyle: dragOver ? 'solid' : 'dashed' }}
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
        <div className="text-[13.5px] font-medium text-ink-2">{label}</div>
      )}
      {helperText !== undefined && (
        <div className="mt-2 text-[11.5px] text-mute-soft">{helperText}</div>
      )}
      {children}
    </div>
  );
}
