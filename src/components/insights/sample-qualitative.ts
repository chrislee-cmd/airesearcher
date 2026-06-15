import type {
  QualitativeForJob,
  TensionWithQuotes,
} from '@/lib/insights-qualitative-load';

// Exploration PR 6b-2 ONLY — design-iteration fixture so the team can
// compare TensionMap variants without re-uploading + waiting on a fresh
// LLM run for each preview deploy. Removed entirely in the real PR.
//
// Shape matches a typical 5-participant / 4-axis qualitative pass from
// the real /finalize qualitative extractor (Sonnet 4.6). Verbatim
// participant quotes are paraphrased composites of patterns seen in
// the 투자·소비·저축 인터뷰 데이터 셋 the team has been testing on.
export const SAMPLE_TENSIONS: TensionWithQuotes[] = [
  {
    id: 't1',
    participant_name: 'P1',
    axis: '안정 vs 도전',
    lo_val: 0.7,
    hi_val: 0.3,
    lo_quote: {
      id: 101,
      participant_name: 'P1',
      text: '저는 일단 원금을 까먹는 게 제일 싫어요. 적금이라도 꾸준히 넣는 게 마음이 편합니다.',
    },
    hi_quote: {
      id: 102,
      participant_name: 'P1',
      text: '그래도 가끔은 코인 같은 거 보면 친구들 얘기 들으니까 한 번쯤은 해볼까 싶긴 해요.',
    },
  },
  {
    id: 't2',
    participant_name: 'P2',
    axis: '안정 vs 도전',
    lo_val: 0.2,
    hi_val: 0.8,
    lo_quote: {
      id: 201,
      participant_name: 'P2',
      text: '안정적인 거는 솔직히 지금 월급으로는 답이 없어서요. 큰 거 한 방 안 노리면 못 따라잡아요.',
    },
    hi_quote: {
      id: 202,
      participant_name: 'P2',
      text: '레버리지 끌어다 부동산 들어간 친구들이 결국 다 자산이 늘었거든요. 저도 비슷하게 가야겠다 싶었어요.',
    },
  },
  {
    id: 't3',
    participant_name: 'P3',
    axis: '안정 vs 도전',
    lo_val: 0.5,
    hi_val: 0.5,
    lo_quote: {
      id: 301,
      participant_name: 'P3',
      text: '저축은 무조건 50% 이상은 챙겨야 한다고 봐요. 그게 기본 베이스고요.',
    },
    hi_quote: {
      id: 302,
      participant_name: 'P3',
      text: '근데 ETF 정도는 매달 자동으로 들어가게 세팅해 놨어요. 안 하면 손해 같아서.',
    },
  },
  {
    id: 't4',
    participant_name: 'P1',
    axis: '단기 만족 vs 장기 계획',
    lo_val: 0.65,
    hi_val: 0.35,
    lo_quote: {
      id: 103,
      participant_name: 'P1',
      text: '한 달에 한 번은 좀 비싸도 좋은 식당 가요. 그거 안 하면 일할 동기가 안 생겨요.',
    },
    hi_quote: {
      id: 104,
      participant_name: 'P1',
      text: '그래도 청약은 빠지지 않게 매달 챙기고는 있어요. 언젠가 쓸 데 있겠죠.',
    },
  },
  {
    id: 't5',
    participant_name: 'P4',
    axis: '단기 만족 vs 장기 계획',
    lo_val: 0.25,
    hi_val: 0.75,
    lo_quote: {
      id: 401,
      participant_name: 'P4',
      text: '한 달에 한두 번 외식은 하는데 그 정도가 한계예요. 너무 자주는 안 돼요.',
    },
    hi_quote: {
      id: 402,
      participant_name: 'P4',
      text: '5년 뒤에 전세금 모으는 게 1순위라서 거기서 거꾸로 계산해서 다 짜놨어요.',
    },
  },
  {
    id: 't6',
    participant_name: 'P5',
    axis: '개인 vs 가족',
    lo_val: 0.4,
    hi_val: 0.6,
    lo_quote: {
      id: 501,
      participant_name: 'P5',
      text: '내 돈은 내가 모으는 거고, 부모님께 손 벌리기는 자존심이 안 서요.',
    },
    hi_quote: {
      id: 502,
      participant_name: 'P5',
      text: '근데 결국 집 살 때는 부모님 도움 없으면 진짜 불가능하더라고요. 받아야죠.',
    },
  },
  {
    id: 't7',
    participant_name: 'P2',
    axis: '정보 신뢰 vs 직감',
    lo_val: 0.55,
    hi_val: 0.45,
    lo_quote: {
      id: 203,
      participant_name: 'P2',
      text: '유튜브에서 보는 거랑 실제 차트랑 맞춰보면서 결정해요. 데이터 없이는 안 움직여요.',
    },
    hi_quote: {
      id: 204,
      participant_name: 'P2',
      text: '그래도 마지막에는 그냥 느낌이에요. 이건 가야 한다, 이건 빠져야 한다 그런 거.',
    },
  },
  {
    id: 't8',
    participant_name: 'P3',
    axis: '정보 신뢰 vs 직감',
    lo_val: 0.85,
    hi_val: 0.15,
    lo_quote: {
      id: 303,
      participant_name: 'P3',
      text: '저는 분기 리포트 안 보고는 절대 안 사요. 매출 추이부터 다 체크합니다.',
    },
    hi_quote: {
      id: 304,
      participant_name: 'P3',
      text: '직감으로 산 적 한 번 있는데 결과는 좋았어요. 근데 다시 그렇게는 못 할 것 같아요.',
    },
  },
];

export const SAMPLE_QUALITATIVE: QualitativeForJob = {
  tensions: SAMPLE_TENSIONS,
  contradictions: [],
};
