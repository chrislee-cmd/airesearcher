export type DeskSourceId = 'google_news' | 'hacker_news' | 'reddit';

export type DeskSourceMeta = {
  id: DeskSourceId;
  label: string;
  labelEn: string;
  hint: string;
};

export const DESK_SOURCES: DeskSourceMeta[] = [
  {
    id: 'google_news',
    label: '구글 뉴스',
    labelEn: 'Google News',
    hint: '국내·해외 뉴스 RSS',
  },
  {
    id: 'hacker_news',
    label: '해커 뉴스',
    labelEn: 'Hacker News',
    hint: '테크/스타트업 커뮤니티',
  },
  {
    id: 'reddit',
    label: '레딧',
    labelEn: 'Reddit',
    hint: '글로벌 사용자 토론',
  },
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
