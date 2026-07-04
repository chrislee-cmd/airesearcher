import type { DeskSourceDefinition } from './types';
import { kakaoFetcher } from './kakao';

export const kakaoCafe: DeskSourceDefinition = {
  id: 'kakao_cafe',
  category: 'community',
  group: 'kakao',
  label: '다음 카페',
  labelEn: 'Daum Cafe',
  hint: '커뮤니티 카페 게시글',
  regionOnly: ['KR'],
  envKeys: ['KAKAO_REST_API_KEY'],
  fetch: kakaoFetcher('cafe', 'kakao_cafe'),
};
