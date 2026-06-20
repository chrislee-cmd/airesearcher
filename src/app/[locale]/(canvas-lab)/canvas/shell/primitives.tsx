/* ────────────────────────────────────────────────────────────────────
   Canvas shell primitives — 도메인 X 인 작은 UI 부품.
   ──────────────────────────────────────────────────────────────────── */

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider text-mute-soft">
        {label}
      </div>
      {children}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-wider text-mute-soft">{children}</div>;
}

export function Pill({ label, cls, small }: { label: string; cls: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill ${cls} ${
        small ? 'px-2 py-0 text-xs' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {label}
    </span>
  );
}

export function CTA({ label }: { label: string }) {
  return (
    <button className="mt-1 w-full rounded-xs border border-amore bg-amore px-3 py-2.5 text-md font-medium text-paper-soft hover:opacity-90">
      {label}
    </button>
  );
}
