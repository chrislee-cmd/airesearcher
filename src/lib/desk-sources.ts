export type DeskSourceId =
  // Naver Search API
  | 'naver_news'
  | 'naver_blog'
  | 'naver_cafe'
  | 'naver_kin'
  // Kakao (Daum) Search API
  | 'kakao_web'
  | 'kakao_blog'
  | 'kakao_cafe'
  // YouTube
  | 'youtube'
  // Global
  | 'google_news'
  | 'hacker_news'
  | 'reddit';

export type DeskSourceGroup = 'naver' | 'kakao' | 'youtube' | 'global';

// Target region for crawling. Independent of UI locale: a Korean researcher
// can target the US, and an English-speaking researcher can target Korea.
// 'GLOBAL' means "no specific country" (Google News pulls international, etc).
export type DeskRegion =
  | 'KR'
  | 'US'
  | 'SG'
  | 'MY'
  | 'TH'
  | 'JP'
  | 'GLOBAL';

export const DESK_REGIONS: DeskRegion[] = ['KR', 'US', 'SG', 'MY', 'TH', 'JP', 'GLOBAL'];

// Sources that only return Korean-language content. Hidden when region != 'KR'
// because they will return zero results for non-KR keywords (and waste credits).
export const KR_ONLY_GROUPS: DeskSourceGroup[] = ['naver', 'kakao'];

export type DeskSourceMeta = {
  id: DeskSourceId;
  group: DeskSourceGroup;
  label: string;
  labelEn: string;
  hint: string;
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
};

export const DESK_SOURCES: DeskSourceMeta[] = [
  { id: 'naver_news', group: 'naver', label: '네이버 뉴스', labelEn: 'Naver News', hint: '국내 언론·포털 기사' },
  { id: 'naver_blog', group: 'naver', label: '네이버 블로그', labelEn: 'Naver Blog', hint: '리뷰·후기·개인 블로그' },
  { id: 'naver_cafe', group: 'naver', label: '네이버 카페글', labelEn: 'Naver Cafe', hint: '커뮤니티 게시글 (제목·요약)' },
  { id: 'naver_kin', group: 'naver', label: '지식iN', labelEn: 'Naver KiN', hint: '실사용자 질문·답변' },
  { id: 'kakao_web', group: 'kakao', label: '다음 웹문서', labelEn: 'Daum Web', hint: '뉴스·웹페이지 통합' },
  { id: 'kakao_blog', group: 'kakao', label: '다음 블로그', labelEn: 'Daum Blog', hint: '티스토리·다음 블로그' },
  { id: 'kakao_cafe', group: 'kakao', label: '다음 카페', labelEn: 'Daum Cafe', hint: '커뮤니티 카페 게시글' },
  { id: 'youtube', group: 'youtube', label: '유튜브', labelEn: 'YouTube', hint: '영상 제목·설명·채널' },
  { id: 'google_news', group: 'global', label: '구글 뉴스', labelEn: 'Google News', hint: '국내·해외 뉴스 RSS' },
  { id: 'hacker_news', group: 'global', label: '해커 뉴스', labelEn: 'Hacker News', hint: '테크/스타트업 영문' },
  { id: 'reddit', group: 'global', label: '레딧', labelEn: 'Reddit', hint: '글로벌 사용자 토론' },
];

export type DeskArticle = {
  source: DeskSourceId;
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  origin?: string;
  keyword: string;
};
