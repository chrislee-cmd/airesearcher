// Public entry point for the desk-source registry. Consumers import everything
// they need from `@/lib/desk-sources`; the per-source modules and the registry
// stay internal. Adding a source touches only `<source>.ts` + `registry.ts`.

export type {
  DeskSourceId,
  DeskSourceGroup,
  DeskSourceCategory,
  DeskRegion,
  DeskDateRange,
  DeskArticle,
  DeskSourceFetcher,
  DeskSourceDefinition,
  DeskSourceMeta,
} from './types';

export {
  DESK_REGIONS,
  KR_ONLY_GROUPS,
  DESK_REGION_PORTALS,
  DESK_SOURCE_GROUPS,
} from './metadata';

export {
  DESK_SOURCE_REGISTRY,
  DESK_SOURCES,
  getEnabledSources,
  sourceMissingKey,
} from './registry';

export type { UICategory } from './ui-categories';
export { UI_CATEGORY_ORDER, UI_CATEGORY_META } from './ui-categories';
