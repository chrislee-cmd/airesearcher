// Interview V2 — trust-badge option A: a static one-line summary strip that
// sits directly under the file list in the project-detail view. Compact,
// high-density, no interaction — it hands the user an at-a-glance "your data
// is fully indexed and answers stay grounded" reassurance.
//
// Two rows:
//   1. hard numbers — files / chunks / embedding coverage (embedRate 0-1)
//   2. the grounding guarantee copy
//
// Copy is intentionally hardcoded (not i18n) to match the spec verbatim:
// this is one of three competing trust-UX experiments (A/B/C) meant for a
// quick visual comparison, after which two are closed. Colours/spacing use
// design-system tokens only (PROJECT.md §9); the top separator is a single
// token border rather than the spec's arbitrary 2px, per the 1px-border rule.

export function TrustBadgeStrip({
  fileCount,
  chunkCount,
  embedRate,
}: {
  fileCount: number;
  chunkCount: number;
  embedRate: number;
}) {
  return (
    <div className="mt-3 space-y-1 border-t border-line pt-3">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        <span aria-hidden>✅</span>
        <span>
          파일 <strong>{fileCount}개</strong> · 청크{' '}
          <strong>{chunkCount}개</strong> · 임베딩{' '}
          <strong>{Math.round(embedRate * 100)}%</strong>
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-mute">
        <span aria-hidden>🛡</span>
        <span>근거 재구성 · 근거 없으면 답변 안 함 · 원문 무손실</span>
      </div>
    </div>
  );
}
