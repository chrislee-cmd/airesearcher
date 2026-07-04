import type { DeskSourceDefinition } from './types';
import { kakaoFetcher } from './kakao';

export const kakaoBlog: DeskSourceDefinition = {
  id: 'kakao_blog',
  category: 'community',
  group: 'kakao',
  label: '다음 블로그',
  labelEn: 'Daum Blog',
  hint: '티스토리·다음 블로그',
  regionOnly: ['KR'],
  envKeys: ['KAKAO_REST_API_KEY'],
  fetch: kakaoFetcher('blog', 'kakao_blog'),
};
