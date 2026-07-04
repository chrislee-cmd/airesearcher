import type { DeskSourceDefinition } from './types';
import { naverFetcher } from './naver';

export const naverKin: DeskSourceDefinition = {
  id: 'naver_kin',
  category: 'community',
  group: 'naver',
  label: '지식iN',
  labelEn: 'Naver KiN',
  hint: '실사용자 질문·답변',
  regionOnly: ['KR'],
  envKeys: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
  fetch: naverFetcher('kin', 'naver_kin'),
};
