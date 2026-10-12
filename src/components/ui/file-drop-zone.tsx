'use client';

import {
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';

// ─── 컨트롤 패널 dropzone 세로 패딩 SSOT (PR-432) ────────────────────────────
// 위젯 컨트롤 보드(ControlBoardPanel)의 인라인 업로드 dropzone 세로 높이를
// 한 곳에서 소유. 전에는 위젯마다 py-12/py-10/py-8 을 제각각 하드코드해
// 전사록(py-12) vs 인터뷰(py-10) 업로드 컨테이너 높이가 미세하게 달랐다.
// 표준값 = py-12 (dropzone 사용처 다수가 이미 채택한 값). 컨트롤 dropzone 은
// 임의 py-* 대신 이 상수를 참조해 6 위젯 업로드 컨테이너 높이를 픽셀 정합한다.
export const FILE_DROP_ZONE_PY = 'py-12';

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
  // Bare 모드 — 프리미티브의 memphis 인라인 프레임(border/radius/shadow/bg)을
  // 걷어내고 className 이 프레임 비주얼을 통째로 소유한다(예: 업로드 모달의 CD
  // 점선 드롭존 — upload-modal-BUILD-SPEC §1·3). 네이티브 <input>·drag·키보드
  // 메커니즘은 그대로. Modal.bare 와 동일 패턴. 미지정(기본 false)이면 기존
  // memphis 룩 그대로 → 6 위젯 컨트롤 dropzone 회귀 0.
  bare?: boolean;
  // 슈퍼어드민 DS 인스펙터용 primitive 이름. 기본 'FileDropZone'. ControlDropzone
  // 이 FileDropZone 을 감싸 쓰므로 자기 이름('ControlDropzone')으로 덮어쓴다.
  dsPrimitive?: string;
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
  bare = false,
  dsPrimitive = 'FileDropZone',
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

  // Soft Identity (리브랜드 2단계) — 드롭존 = 변환표의 "빈 상태 타일" 유형.
  // 평소 = 1.5px dashed --line-hover(#d6d4da) · 그림자 없음(핵심규칙 1 의 허용
  // 예외 "점선 빈 자리" + 핵심규칙 2 "하드 오프셋 전면 폐지"). drag-over(받을
  // 수 있음) = 1px 실선 --ink + --focus-ring — README §Interactions "하드
  // 그림자로 포커스를 표시하지 않습니다". 하드 오프셋이 사라졌으므로 그 짝이던
  // translate 리프트도 같이 뺀다.
  const dropBorder = dragOver
    ? '1px solid var(--ink)'
    : '1.5px dashed var(--line-hover)';
  const dropShadow = dragOver ? 'var(--focus-ring)' : 'none';
  const dropBg = dragOver
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
      } ${className ?? ''}`}
      style={
        bare
          ? undefined
          : {
              background: dropBg,
              border: dropBorder,
              borderRadius: 'var(--sidebar-nav-radius)',
              boxShadow: dropShadow,
            }
      }
      {...rest}
      data-ds-primitive={dsPrimitive}
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
