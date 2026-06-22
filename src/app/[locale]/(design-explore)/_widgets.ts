// 3 시안에서 공유하는 mock widget 데이터. production features.ts 와 무관.

export type DemoWidget = {
  key: string;
  label: string;
  description: string;
  cost: string;
};

export const DEMO_WIDGETS: DemoWidget[] = [
  {
    key: 'desk',
    label: '데스크 리서치',
    description: '키워드로 웹을 훑어 인용 + 한 줄 요약 보고서로',
    cost: '25 크레딧',
  },
  {
    key: 'quotes',
    label: '전사록 생성기',
    description: '오디오·영상을 정확한 전사록(Verbatim)으로 변환',
    cost: '25 크레딧',
  },
  {
    key: 'moderator',
    label: 'AI 모더레이터',
    description: '인터뷰 가이드 자동 생성 + 실시간 모더레이션 보조',
    cost: '1 크레딧',
  },
  {
    key: 'translate',
    label: 'AI 동시통역',
    description: '마이크 음성을 실시간 STT + 동시통역. 공유 링크 발급',
    cost: '50 크레딧',
  },
  {
    key: 'topline',
    label: '전체 리포트 생성기',
    description: '전사록·인터뷰 결과를 한 페이지 토플라인 보고서로',
    cost: '50 크레딧',
  },
  {
    key: 'slidegen',
    label: 'PPT 생성기',
    description: '보고서 텍스트를 도식 슬라이드 덱으로 자동 변환',
    cost: '무료',
  },
];
