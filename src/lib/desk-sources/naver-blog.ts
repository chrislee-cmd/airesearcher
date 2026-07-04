import type { DeskSourceDefinition } from './types';
import { naverFetcher } from './naver';

export const naverBlog: DeskSourceDefinition = {
  id: 'naver_blog',
  category: 'community',
  group: 'naver',
  label: '네이버 블로그',
  labelEn: 'Naver Blog',
  hint: '리뷰·후기·개인 블로그',
  regionOnly: ['KR'],
  envKeys: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
  fetch: naverFetcher('blog', 'naver_blog'),
};
