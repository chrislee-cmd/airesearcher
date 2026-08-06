// Shared sample cluster rendered side-by-side in /design/airbnb (and any
// future /design/<system> comparison routes). Every element uses bento
// token classes (bg-amore, border-line, text-ink, rounded-{sm,md,full}…)
// so that wrapping in <div data-design="airbnb"> swaps the entire visual
// language via CSS variable overrides in globals.css, with zero JSX
// changes between the two columns.

type SampleClusterProps = {
  systemLabel: string;
  tagline: string;
};

export function SampleCluster({ systemLabel, tagline }: SampleClusterProps) {
  return (
    <div className="flex flex-col gap-8 bg-paper p-8 text-ink">
      <header className="flex flex-col gap-1">
        <div className="eyebrow-mute">design system</div>
        <h2 className="text-3xl font-semibold tracking-[-0.01em]">{systemLabel}</h2>
        <p className="text-md text-mute">{tagline}</p>
      </header>

      <ButtonsRow />
      <SearchBarRow />
      <PropertyCard />
      <InputsRow />
      <RatingRow />
    </div>
  );
}

function ButtonsRow() {
  return (
    <section className="flex flex-col gap-3">
      <Caption>Buttons — primary / secondary / pill</Caption>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-sm bg-amore px-6 py-3 text-md font-medium text-paper hover:bg-amore-soft"
        >
          Reserve
        </button>
        <button
          type="button"
          className="rounded-sm border border-ink bg-paper px-6 py-3 text-md font-medium text-ink hover:bg-ink hover:text-paper"
        >
          Save
        </button>
        <button
          type="button"
          className="rounded-full bg-amore px-5 py-2.5 text-sm font-medium text-paper hover:bg-amore-soft"
        >
          Become a host
        </button>
        <button
          type="button"
          disabled
          className="rounded-sm bg-amore-bg px-6 py-3 text-md font-medium text-paper opacity-100 disabled:cursor-not-allowed"
        >
          Disabled
        </button>
      </div>
    </section>
  );
}

function SearchBarRow() {
  return (
    <section className="flex flex-col gap-3">
      <Caption>Search bar — pill + orb</Caption>
      <div className="flex max-w-[640px] items-center gap-0 rounded-full border border-line bg-paper p-2 pl-6 shadow-bento">
        <SearchSegment label="Where" placeholder="Search destinations" />
        <Divider />
        <SearchSegment label="When" placeholder="Add dates" />
        <Divider />
        <SearchSegment label="Who" placeholder="Add guests" />
        <button
          type="button"
          aria-label="Search"
          className="ml-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amore text-paper hover:bg-amore-soft"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M12.5 12.5L16 16M7.5 13a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </section>
  );
}

function SearchSegment({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div className="flex flex-1 flex-col px-4 py-1.5">
      <span className="text-xs font-semibold text-ink">{label}</span>
      <span className="text-sm text-mute">{placeholder}</span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-7 w-px bg-line" />;
}

function PropertyCard() {
  return (
    <section className="flex flex-col gap-3">
      <Caption>Property card — rounded-md (~14px) photo + meta</Caption>
      <article className="flex w-[280px] flex-col gap-2">
        <div className="relative aspect-square overflow-hidden rounded-md bg-pacific-bg">
          <div className="absolute left-3 top-3 rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-ink shadow-bento">
            Guest favorite
          </div>
          <button
            type="button"
            aria-label="Save"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-pacific-bg text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 14s-5.5-3.4-5.5-7.2A3.3 3.3 0 0 1 8 4.6a3.3 3.3 0 0 1 5.5 2.2C13.5 10.6 8 14 8 14Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex items-baseline justify-between">
          <p className="text-md font-semibold text-ink">Seogwipo, Jeju</p>
          <p className="text-md text-ink">★ 4.93</p>
        </div>
        <p className="text-sm text-mute">3,210 km away</p>
        <p className="text-sm text-mute">Nov 18 – 23</p>
        <p className="text-md text-ink"><span className="font-semibold">₩186,000</span> night</p>
      </article>
    </section>
  );
}

function InputsRow() {
  return (
    <section className="flex flex-col gap-3">
      <Caption>Text input — outlined, focus to ink</Caption>
      <div className="grid max-w-[480px] grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-mute">First name</span>
          <input
            type="text"
            defaultValue="Chris"
            className="h-12 rounded-sm border border-line bg-paper px-3 text-md text-ink focus:border-ink focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-mute">Email</span>
          <input
            type="email"
            placeholder="you@example.com"
            className="h-12 rounded-sm border border-line bg-paper px-3 text-md text-ink focus:border-ink focus:outline-none"
          />
        </label>
      </div>
    </section>
  );
}

function RatingRow() {
  return (
    <section className="flex flex-col gap-3">
      <Caption>Rating display — type does the work</Caption>
      <div className="flex items-center gap-4">
        <span className="text-display font-bold leading-none tracking-tight text-ink">4.81</span>
        <div className="flex flex-col gap-1">
          <p className="text-md font-semibold text-ink">Guest favorite</p>
          <p className="text-sm text-mute">One of the most loved homes on the platform</p>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-amore" />
        <span className="text-sm text-mute">Single accent dot — brand voltage</span>
      </div>
    </section>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow-mute">{children}</div>;
}
