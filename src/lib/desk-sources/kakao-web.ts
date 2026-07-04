import type { DeskSourceDefinition } from './types';
import { kakaoFetcher } from './kakao';

export const kakaoWeb: DeskSourceDefinition = {
  id: 'kakao_web',
  category: 'news',
  group: 'kakao',
  label: '다음 웹문서',
  labelEn: 'Daum Web',
  hint: '뉴스·웹페이지 통합',
  regionOnly: ['KR'],
  envKeys: ['KAKAO_REST_API_KEY'],
  fetch: kakaoFetcher('web', 'kakao_web'),
};
