// Region / group metadata. Data-only — no fetch logic. Consumed by the UI
// (source picker) and the route. Kept out of individual source modules because
// it describes the whole source space, not one source.

import type { DeskRegion, DeskSourceGroup } from './types';

export const DESK_REGIONS: DeskRegion[] = ['KR', 'US', 'SG', 'MY', 'TH', 'JP', 'GLOBAL'];

// Sources that only return Korean-language content. Hidden when region != 'KR'
// because they will return zero results for non-KR keywords (and waste credits).
export const KR_ONLY_GROUPS: DeskSourceGroup[] = [
  'naver',
  'kakao',
  'dart',
  'academic_kr',
  'bok',
  'kosis',
  'atfis',
  'institute_kr',

];

// Famous, crawler-friendly portals per region. Reached directly via API, or
// indirectly via Google News RSS aggregation. Shown in the UI as a hint.
export const DESK_REGION_PORTALS: Record<DeskRegion, string[]> = {
  KR: ['Naver', 'Daum', 'YouTube', 'Google News'],
  US: ['Google News', 'Reddit', 'Hacker News', 'YouTube'],
  JP: ['Yahoo! Japan', 'Google News', 'YouTube'],
  SG: ['Straits Times', 'CNA', 'Google News', 'YouTube'],
  MY: ['The Star', 'Free Malaysia Today', 'Google News', 'YouTube'],
  TH: ['Bangkok Post', 'Thairath', 'Google News', 'YouTube'],
  GLOBAL: ['Google News', 'Reddit', 'Hacker News', 'YouTube'],
};

export const DESK_SOURCE_GROUPS: Record<
  DeskSourceGroup,
  { label: string; labelEn: string; hint: string }
> = {
  naver: {
    label: '네이버',
    labelEn: 'Naver',
    hint: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 필요',
  },
  kakao: {
    label: '카카오·다음',
    labelEn: 'Kakao / Daum',
    hint: 'KAKAO_REST_API_KEY 필요',
  },
  youtube: {
    label: '유튜브',
    labelEn: 'YouTube',
    hint: 'YOUTUBE_API_KEY 필요',
  },
  global: {
    label: '글로벌',
    labelEn: 'Global',
    hint: '키 없이 동작',
  },
  dart: {
    label: 'DART 공시',
    labelEn: 'DART (Financial Disclosures)',
    hint: 'DART_API_KEY 필요',
  },
  academic_kr: {
    label: '국내 학술',
    labelEn: 'Korean Academic',
    hint: 'KCI_API_KEY 필요 (한국연구재단)',
  },
  bok: {
    label: '한국은행',
    labelEn: 'Bank of Korea',
    hint: 'ECOS_API_KEY 필요',
  },
  kosis: {
    label: '통계청 KOSIS',
    labelEn: 'KOSIS (Korea Statistics)',
    hint: 'KOSIS_API_KEY 필요',
  },
  atfis: {
    label: 'aTFIS 식품산업통계',
    labelEn: 'aTFIS (Food Industry Statistics)',
    hint: '키 없이 동작 (가공식품 세분시장 시장규모 보고서)',
  },
  institute_kr: {
    label: '국내 연구소',
    labelEn: 'Korean Research Institutes',
    hint: '키 없이 동작 (KISDI/KIET/KOTRA/KISTEP 공개 RSS)',
  },
};
