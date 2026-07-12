// turndown-plugin-gfm 는 타입을 배포하지 않는다. GFM 표/취소선 등 플러그인을
// TurndownService.use()에 넘길 수 있게 최소 형태만 선언한다.
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
  export const highlightedCodeBlock: TurndownService.Plugin;
}
