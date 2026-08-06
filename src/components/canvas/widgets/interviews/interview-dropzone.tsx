'use client';

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import DuotoneIcon from '@/components/ui/icons/duotone-icon';
import {
  HiddenFileInput,
  type HiddenFileInputHandle,
} from '@/components/ui/hidden-file-input';

// ─── 인터뷰 카드 드롭존 (BUILD-SPEC §1.1, S1 1a/1b) ──────────────────────────
// fresh CD 프레젠테이션: 3px dashed 프레임 · radius 14 · shadow-dropzone(활성).
// 드래그드롭은 div 의 dataTransfer 로, 클릭은 HiddenFileInput(ui primitive)로 OS
// 다이얼로그를 연다 (native <input> 을 위젯에 직접 두지 않음 — forbid-elements).
// 25MB 게이트: maxSizeBytes 로 초과 파일을 걸러 낸다(모달이 최종 재검증하지만
// 인라인 UX 를 맞춤 — 기존 ControlDropzone 동작 유지).
//
// disabled(1a idle): 프로젝트 미선택 안내만, 입력 비활성 · paper-soft · opacity.

const INK = 'var(--color-ink)';

export function InterviewDropzone({
  title,
  helper,
  actionLabel,
  accept,
  maxSizeBytes,
  onFiles,
  disabled = false,
}: {
  title: ReactNode;
  helper: ReactNode;
  // 활성일 때만 노출하는 "파일 선택" 버튼 라벨.
  actionLabel?: string;
  accept?: string;
  maxSizeBytes?: number;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HiddenFileInputHandle>(null);

  const emit = (files: File[]) => {
    const ok = maxSizeBytes
      ? files.filter((f) => f.size <= maxSizeBytes)
      : files;
    if (ok.length > 0) onFiles(ok);
  };

  if (disabled) {
    return (
      <div
        aria-disabled
        className="flex flex-col items-center gap-2.5 rounded-sm bg-paper-soft text-center"
        style={{
          padding: '40px 22px',
          border: '3px dashed var(--color-line-empty)',
        }}
      >
        <DuotoneIcon name="upload" size={30} className="opacity-35" />
        <div className="font-bold text-faint" style={{ fontSize: 13.5 }}>
          {title}
        </div>
        <div className="text-faint" style={{ fontSize: 12, lineHeight: 1.6 }}>
          {helper}
        </div>
      </div>
    );
  }

  const open = () => inputRef.current?.open();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        emit(Array.from(e.dataTransfer.files));
      }}
      className={`flex cursor-pointer flex-col items-center gap-3 rounded-sm bg-paper text-center transition-[transform,box-shadow] duration-[140ms] motion-reduce:transition-none ${
        dragOver ? '-translate-x-px -translate-y-px' : ''
      }`}
      style={{
        padding: '44px 22px',
        border: `3px dashed ${INK}`,
        boxShadow: 'var(--shadow-dropzone)',
      }}
    >
      <DuotoneIcon name="upload" size={34} />
      <div className="font-extrabold text-ink" style={{ fontSize: 15 }}>
        {title}
      </div>
      <div className="text-mute" style={{ fontSize: 12.5, lineHeight: 1.65 }}>
        {helper}
      </div>
      {actionLabel && (
        <span
          className="mt-1.5 inline-flex items-center gap-2 rounded-pill bg-ink font-bold text-paper shadow-memphis-sm-faint"
          style={{ padding: '10px 20px', fontSize: 13 }}
        >
          {actionLabel}
        </span>
      )}
      <HiddenFileInput
        ref={inputRef}
        accept={accept}
        multiple
        onFiles={emit}
      />
    </div>
  );
}
