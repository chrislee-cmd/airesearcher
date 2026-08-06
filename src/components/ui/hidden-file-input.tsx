'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

// ─── HiddenFileInput — 헤드리스 파일 선택 primitive ──────────────────────────
// 순수 로직 primitive: 화면에 아무것도 그리지 않는 hidden <input type="file"> +
// imperative open() 핸들. 소비처(위젯)는 자기 디자인의 div/pill 을 그리고, 클릭
// 시 ref.open() 으로 OS 파일 다이얼로그를 연다.
//
// 존재 이유: `react/forbid-elements` (design-system/no-native-controls) 가
// src/components/ui/ 밖의 native <input> 을 CI 에서 차단한다(§3.8). CD 프레젠테이션
// 을 fresh 로 짓는 위젯이 native input 을 직접 둘 수 없으므로, native element 는
// 이 primitive 안에 격리하고 위젯은 open() 만 호출한다 — FileDropZone(고정
// memphis 프레임)과 달리 프레임/스타일을 전혀 강제하지 않는다.

export type HiddenFileInputHandle = { open: () => void };

export const HiddenFileInput = forwardRef<
  HiddenFileInputHandle,
  {
    accept?: string;
    multiple?: boolean;
    onFiles: (files: File[]) => void;
  }
>(function HiddenFileInput({ accept, multiple = false, onFiles }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ open: () => inputRef.current?.click() }), []);
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      className="hidden"
      onChange={(e) => {
        const list = e.target.files;
        if (list && list.length > 0) onFiles(Array.from(list));
        e.target.value = '';
      }}
    />
  );
});

export default HiddenFileInput;
