export type ExportFormat =
  | 'md'
  | 'html'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'json'
  | 'txt'
  | 'pdf'
  | 'pptx';

type FormatMeta = {
  ext: string;
  mime: string;
  // i18n key under Common.export — components look the label up via
  // useTranslations('Common.export') so locale strings stay in
  // messages/{ko,en}.json rather than embedded here.
  labelKey: ExportFormat;
};

export const FORMAT_META: Record<ExportFormat, FormatMeta> = {
  md: { ext: 'md', mime: 'text/markdown;charset=utf-8', labelKey: 'md' },
  html: { ext: 'html', mime: 'text/html;charset=utf-8', labelKey: 'html' },
  docx: {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    labelKey: 'docx',
  },
  xlsx: {
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    labelKey: 'xlsx',
  },
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8', labelKey: 'csv' },
  json: { ext: 'json', mime: 'application/json;charset=utf-8', labelKey: 'json' },
  txt: { ext: 'txt', mime: 'text/plain;charset=utf-8', labelKey: 'txt' },
  pdf: { ext: 'pdf', mime: 'application/pdf', labelKey: 'pdf' },
  pptx: {
    ext: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    labelKey: 'pptx',
  },
};
