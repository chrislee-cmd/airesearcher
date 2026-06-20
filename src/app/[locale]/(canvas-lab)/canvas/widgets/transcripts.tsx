'use client';

import type { WidgetContent } from '../widget-types';
import { Label } from '../shell/primitives';

function PrimaryAction() {
  return (
    <div className="space-y-3">
      <Label>파일 추가</Label>
      <div className="flex h-24 items-center justify-center rounded-xs border border-dashed border-line bg-paper text-md text-mute hover:border-amore hover:bg-amore-bg">
        파일 드래그 또는 <span className="ml-1 text-amore">클릭해서 선택</span>
      </div>
      <div className="flex gap-2 text-xs text-mute-soft">
        <span>.mp3 · .m4a · .wav · .mp4</span>
        <span className="ml-auto">화자 분리 자동</span>
      </div>
    </div>
  );
}

export const transcriptsContent: WidgetContent = {
  key: 'transcripts',
  meta: {
    label: '전사록 생성기',
    subtitle: '녹음 파일을 화자 분리 + 시점 stamp 가 찍힌 전사록으로',
    cost: 1,
    accent: 'lav',
  },
  state: 'running',
  progress: 32,
  phaseLabel: '추출 중 · 2 of 3',
  stats: [
    { label: '처리한 시간', value: '28h 04m' },
    { label: '평균 처리속도', value: '0.4×' },
    { label: '라이브러리', value: '76건' },
  ],
  recents: [
    { name: '인터뷰_01_김민지.docx', meta: '64분 · 화자 2명' },
    { name: '인터뷰_02_박지훈.docx', meta: '58분 · 화자 2명' },
    { name: 'FGD_워킹맘_세션1.docx', meta: '92분 · 화자 7명' },
    { name: 'UT_노년층_03.docx', meta: '47분 · 화자 2명' },
  ],
  queue: [
    { name: '인터뷰_03_이수아.m4a', progress: 78, eta: '약 2분' },
    { name: '인터뷰_04_정태욱.m4a', progress: 24, eta: '약 6분' },
    { name: 'FGD_세션2.mp3', progress: 0, eta: '대기 중' },
  ],
  PrimaryAction,
  expandedHeight: 660,
};
