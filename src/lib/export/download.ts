// Single source of truth for triggering downloads in the browser.
// All feature pages should call these instead of hand-rolling
// `URL.createObjectURL` + temporary anchor patterns (which were
// duplicated in 5+ places — see PROJECT.md component-system audit).

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerUrlDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function triggerUrlDownload(href: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
