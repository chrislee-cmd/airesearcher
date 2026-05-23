import type { ReactNode } from 'react';

export type PanelKey =
  | 'desk'
  | 'screener'
  | 'guideline'
  | 'moderator'
  | 'verbatim'
  | 'interview'
  | 'report'
  | 'quant'
  | 'affinity';

export type PanelTab = {
  label: string;
  num: string;
  body: ReactNode;
};

export type PanelDef = {
  crumb: string;
  title: string;
  cost: string;
  manualAdd?: boolean;
  ws: { who: string; ttl: string; sub: string };
  next: { key: PanelKey; label: string };
  tabs: PanelTab[];
};

export type Panels = Record<PanelKey, PanelDef>;

export const PANEL_ORDER: PanelKey[] = [
  'desk',
  'screener',
  'guideline',
  'moderator',
  'verbatim',
  'interview',
  'report',
  'quant',
  'affinity',
];

export const SIDEBAR_GROUPS: { group: 'design' | 'conduct' | 'analysis'; keys: PanelKey[] }[] = [
  { group: 'design', keys: ['desk', 'screener', 'guideline'] },
  { group: 'conduct', keys: ['moderator'] },
  { group: 'analysis', keys: ['verbatim', 'interview', 'report', 'quant', 'affinity'] },
];

export const TOOL_COST_DOTS: Record<PanelKey, string> = {
  desk: '25',
  screener: '5',
  guideline: '5',
  moderator: '1',
  verbatim: '25',
  interview: '10',
  report: '50',
  quant: '15',
  affinity: '·',
};
