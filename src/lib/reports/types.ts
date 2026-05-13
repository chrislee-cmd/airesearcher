// Single source of truth for the report-direction chooser. The four
// values map 1:1 onto a prompt module under ./prompts. The default of
// 'findings' is the closest to the pre-chooser behavior — backwards
// compatible for any caller that omits the field.

export const REPORT_TYPES = [
  'design',
  'marketing',
  'strategy',
  'findings',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const DEFAULT_REPORT_TYPE: ReportType = 'findings';

export function isReportType(v: unknown): v is ReportType {
  return typeof v === 'string' && (REPORT_TYPES as readonly string[]).includes(v);
}

export function coerceReportType(v: unknown): ReportType {
  return isReportType(v) ? v : DEFAULT_REPORT_TYPE;
}
