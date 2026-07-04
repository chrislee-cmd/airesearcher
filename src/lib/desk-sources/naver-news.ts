import type { DeskSourceDefinition } from './types';
import { naverFetcher } from './naver';

export const naverNews: DeskSourceDefinition = {
  id: 'naver_news',
  category: 'news',
  group: 'naver',
  label: '네이버 뉴스',
  labelEn: 'Naver News',
  hint: '국내 언론·포털 기사',
  regionOnly: ['KR'],
  envKeys: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
  fetch: naverFetcher('news', 'naver_news'),
};
