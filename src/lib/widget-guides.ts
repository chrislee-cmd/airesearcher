import type { FeatureKey } from '@/lib/features';

// ── 위젯 영상 가이드 정적 config (CD widget-toolbar-guide §4) ──────────────
//
// 카드 헤더 툴바 `?` 버튼이 여는 per-위젯 how-to 영상 모달의 참조 데이터.
// DB 아님 — 릴리즈 주기 콘텐츠라 카드 렌더마다 쿼리를 피하고, 타입세이프 +
// git 리뷰 가능한 정적 모듈로 둔다. 실 영상이 준비되면 아래 `videoUrl` 값만
// 위젯별로 교체하면 되고 컴포넌트/스키마 변경은 0.
//
// 호스팅 = Supabase Storage 공개 버킷 `widget-guides` (네이티브 <video> +
// CDN range). 샘플 단계에서는 6위젯 전부 동일한 SAMPLE 영상(H.264 트랜스코드,
// 1280×720 · 22s). 로케일 분리 없음(단일) — 내레이션 로케일이 생기면
// `videoUrl` 을 `Record<locale,string>` 으로 확장(지금 불필요).

export type WidgetGuide = {
  // 공개 영상 URL. 샘플 단계에서는 전부 동일 SAMPLE.
  videoUrl: string;
  // 없으면 player 가 poster 없이 play 버튼만 노출.
  posterUrl?: string;
  // CD duration pill 표기(예 "0:22"). 실 재생시간은 <video> 메타에서 읽고,
  // 이 값은 로드 전 표시 + 폴백.
  durationLabel: string;
  // i18n blurb 키 (CD §4 per-widget 문안). root(useTranslations()) 기준 dotted path.
  blurbKey: string;
  // 없으면 "Read the docs" 버튼 미노출.
  docsUrl?: string;
};

const SAMPLE =
  'https://qdhfbvppeilzyihzlusj.supabase.co/storage/v1/object/public/widget-guides/sample.mp4';

// 키 = 캔버스 위젯 key(= FeatureKey). CD 표(Probing / Live Interpreter /
// Transcript Generator / AI UT / Recruiting / Desk Research)를 실제 캔버스
// 위젯 key 로 매핑한다:
//   Probing            → probing       (sky)
//   Live Interpreter   → translate     (mint)
//   Transcript Gener.  → quotes        (lav)  ← 전사록 위젯의 캔버스 key 는 `quotes`
//   AI UT              → moderator_ai  (peach)
//   Recruiting         → recruiting    (sun)
//   Desk Research      → desk          (cyan)
// 헤더 톤은 각 위젯 meta.accent 에서 온다(이 config 아님) — 카드↔모달 헤더 톤
// 자동 일치.
export const WIDGET_GUIDES: Partial<Record<FeatureKey, WidgetGuide>> = {
  probing: {
    videoUrl: SAMPLE,
    durationLabel: '0:22',
    blurbKey: 'WidgetGuide.blurb.probing',
  },
  translate: {
    videoUrl: SAMPLE,
    durationLabel: '0:22',
    blurbKey: 'WidgetGuide.blurb.translate',
  },
  quotes: {
    videoUrl: SAMPLE,
    durationLabel: '0:22',
    blurbKey: 'WidgetGuide.blurb.quotes',
  },
  moderator_ai: {
    videoUrl: SAMPLE,
    durationLabel: '0:22',
    blurbKey: 'WidgetGuide.blurb.moderator_ai',
  },
  recruiting: {
    videoUrl: SAMPLE,
    durationLabel: '0:22',
    blurbKey: 'WidgetGuide.blurb.recruiting',
  },
  desk: {
    videoUrl: SAMPLE,
    durationLabel: '0:22',
    blurbKey: 'WidgetGuide.blurb.desk',
  },
};

// 위젯 key(문자열)로 가이드 조회. 캔버스 위젯 key 는 string 이므로 FeatureKey
// 캐스팅 없이 받는다 — 미등록 키는 null(=가이드 없음 → `?` 버튼 미노출).
export function widgetGuide(key: string): WidgetGuide | null {
  return (
    (WIDGET_GUIDES as Record<string, WidgetGuide | undefined>)[key] ?? null
  );
}
