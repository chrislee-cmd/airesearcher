// Voice Concierge — server-safe shared type definitions for tools.
//
// This module is import-safe from both server (API routes) and client
// (browser tool factory in src/components/voice-concierge/tools.ts).
// It deliberately contains ONLY types + plain data so it can be pulled
// into a runtime=nodejs API route without dragging in next/navigation or
// any other client-only dep.
//
// The actual tool definitions (with execute() bodies that call
// router.push / sessionStorage / fetch) live in the client-side factory
// at src/components/voice-concierge/tools.ts.

import { FEATURES, type FeatureKey } from '@/lib/features';

/**
 * The fixed list of known feature keys, for zod enum validation on the
 * client `navigate` / `startFeature` tools. Mirrors FEATURES[] so a new
 * feature added to features.ts is automatically reachable by the model.
 */
export const FEATURE_KEY_LIST = FEATURES.map((f) => f.key) as [
  FeatureKey,
  ...FeatureKey[],
];

/**
 * Routes the model can navigate to that are NOT in FEATURES (system
 * pages). Kept short and explicit so the model can't be talked into
 * pushing arbitrary internal URLs.
 */
export const SYSTEM_NAVIGABLE_ROUTES = [
  '/dashboard',
  '/credits',
  '/projects',
  '/billing', // future-compat; resolves to /credits in openPurchase today
] as const;

export type SystemNavigableRoute = (typeof SYSTEM_NAVIGABLE_ROUTES)[number];

/**
 * The union of all hrefs the `navigate` tool will accept. Built once at
 * module init from the FEATURES SSOT plus the system routes above.
 */
export const NAVIGABLE_HREFS: readonly string[] = [
  ...FEATURES.map((f) => f.href),
  ...SYSTEM_NAVIGABLE_ROUTES,
];

/**
 * Topics the `escalateToHuman` tool will accept. Anything outside this
 * set is rejected — keeps the support inbox subject lines predictable.
 */
export const ESCALATION_TOPICS = [
  'billing',
  'refund',
  'account',
  'bug',
  'other',
] as const;

export type EscalationTopic = (typeof ESCALATION_TOPICS)[number];

/** The actual purchase page route in this repo. Design called for
 *  `/billing` but the implemented route is `/credits` — kept here so
 *  the client tool factory and any server-side hint stay in sync. */
export const PURCHASE_ROUTE = '/credits';

/** Where escalateToHuman opens a draft email to. */
export const SUPPORT_EMAIL = 'support@meteor-research.com';
