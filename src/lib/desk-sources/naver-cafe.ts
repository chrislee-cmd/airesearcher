import type { DeskSourceDefinition } from './types';
import { naverFetcher } from './naver';

export const naverCafe: DeskSourceDefinition = {
  id: 'naver_cafe',
  category: 'community',
  group: 'naver',
  label: '네이버 카페글',
  labelEn: 'Naver Cafe',
  hint: '커뮤니티 게시글 (제목·요약)',
  regionOnly: ['KR'],
  envKeys: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
  fetch: naverFetcher('cafearticle', 'naver_cafe'),
};
