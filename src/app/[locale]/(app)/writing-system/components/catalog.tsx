'use client';

import { useMemo, useState } from 'react';
import { ChapterHeader, StatCard } from '@/components/editorial';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  LOCALES,
  type Locale,
  type TokenRow,
  type WritingSystemData,
} from '../lib/types';

type ViewId = 'tokens' | 'glossary' | 'rules';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'tokens', label: 'Text tokens' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'rules', label: 'Writing rules' },
];

// null → the locale has no leaf at this path (would fall back to en).
function MissingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-xs border border-warning bg-warning/10 px-1.5 py-0.5 text-xs font-semibold text-warning">
      ⚠ missing
    </span>
  );
}

function pctLabel(pct: number): string {
  return pct >= 99.95 ? '100%' : `${pct.toFixed(1)}%`;
}

export function WritingSystemCatalog({ data }: { data: WritingSystemData }) {
  const [view, setView] = useState<ViewId>('tokens');

  return (
    <div className="mx-auto max-w-[1280px] px-2 pb-16 pt-6">
      <ChapterHeader
        title="Writing System"
        description="Every user-facing text token (message key) in the codebase, shown across en / ko / ja / th side by side — the text-token peer of the design system. Read-only: values come straight from messages/*.json and docs/WRITING.md. Super admin only."
      />

      <CoverageHeader data={data} />

      <div className="mb-6 mt-8 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button
            key={v.id}
            variant={view === v.id ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setView(v.id)}
          >
            {v.label}
          </Button>
        ))}
      </div>

      {view === 'tokens' && <TokensView data={data} />}
      {view === 'glossary' && <GlossaryView data={data} />}
      {view === 'rules' && <RulesView data={data} />}
    </div>
  );
}

function CoverageHeader({ data }: { data: WritingSystemData }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Total keys"
        value={data.totalKeys.toLocaleString('en-US')}
        caption={`${data.namespaces.length} namespaces`}
      />
      {data.coverage.map((c) => (
        <StatCard
          key={c.locale}
          label={c.locale.toUpperCase()}
          value={pctLabel(c.pct)}
          caption={
            c.missing === 0
              ? `${c.have.toLocaleString('en-US')} keys · parity`
              : `${c.missing.toLocaleString('en-US')} fall back to en`
          }
        />
      ))}
    </div>
  );
}

function TokensView({ data }: { data: WritingSystemData }) {
  const [query, setQuery] = useState('');
  const [ns, setNs] = useState('all');
  const [missingOnly, setMissingOnly] = useState(false);
  const [missingLocale, setMissingLocale] = useState<'any' | Locale>('any');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (ns !== 'all' && row.ns !== ns) return false;
      if (missingOnly && row.missing.length === 0) return false;
      if (missingLocale !== 'any' && !row.missing.includes(missingLocale)) return false;
      if (!q) return true;
      if (row.path.toLowerCase().includes(q)) return true;
      return LOCALES.some((l) => (row.values[l] ?? '').toLowerCase().includes(q));
    });
  }, [data.rows, query, ns, missingOnly, missingLocale]);

  // Regroup filtered rows by namespace, preserving en file order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byNs = new Map<string, TokenRow[]>();
    for (const row of filtered) {
      if (!byNs.has(row.ns)) {
        byNs.set(row.ns, []);
        order.push(row.ns);
      }
      byNs.get(row.ns)!.push(row);
    }
    return order.map((name) => ({ name, rows: byNs.get(name)! }));
  }, [filtered]);

  const nsOptions = [
    { value: 'all', label: `All namespaces (${data.namespaces.length})` },
    ...data.namespaces.map((n) => ({ value: n.ns, label: `${n.ns} (${n.count})` })),
  ];
  const localeOptions = [
    { value: 'any', label: 'Any locale' },
    ...LOCALES.map((l) => ({ value: l, label: l.toUpperCase() })),
  ];

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="md:w-[320px]">
          <Input
            size="sm"
            placeholder="Search key or text…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search text tokens"
          />
        </div>
        <div className="md:w-[240px]">
          <Select
            size="sm"
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            options={nsOptions}
            aria-label="Filter by namespace"
          />
        </div>
        <div className="md:w-[160px]">
          <Select
            size="sm"
            value={missingLocale}
            onChange={(e) => setMissingLocale(e.target.value as 'any' | Locale)}
            options={localeOptions}
            aria-label="Untranslated in locale"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-mute">
          <Checkbox
            checked={missingOnly}
            onChange={(e) => setMissingOnly(e.target.checked)}
          />
          Missing only
        </label>
      </div>

      <div className="mb-3 text-sm text-mute-soft">
        {filtered.length.toLocaleString('en-US')} of{' '}
        {data.totalKeys.toLocaleString('en-US')} keys
      </div>

      {groups.length === 0 ? (
        <div className="rounded-md border border-line bg-paper-soft px-4 py-10 text-center text-md text-mute">
          No keys match the current filters.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.name}>
              <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-2">
                <h3 className="text-lg font-semibold text-ink">{group.name}</h3>
                <span className="text-sm text-mute-soft">{group.rows.length}</span>
              </div>
              <TokenTable rows={group.rows} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TokenTable({ rows }: { rows: TokenRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[18%]" />
          <col className="w-[20.5%]" />
          <col className="w-[20.5%]" />
          <col className="w-[20.5%]" />
          <col className="w-[20.5%]" />
        </colgroup>
        <thead>
          <tr className="text-xs uppercase tracking-[0.14em] text-mute-soft">
            <th className="px-2 py-1.5 text-left font-semibold">Key</th>
            {LOCALES.map((l) => (
              <th key={l} className="px-2 py-1.5 text-left font-semibold">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-t border-line-soft align-top">
              <td className="px-2 py-2">
                <span className="break-words font-medium text-ink">{row.subKey}</span>
              </td>
              {LOCALES.map((l) => (
                <td key={l} className="px-2 py-2">
                  {row.values[l] === null ? (
                    <MissingBadge />
                  ) : (
                    <span className="whitespace-pre-wrap break-words text-mute">
                      {row.values[l]}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GlossaryView({ data }: { data: WritingSystemData }) {
  if (data.glossary.length === 0) {
    return (
      <div className="rounded-md border border-line bg-paper-soft px-4 py-10 text-center text-md text-mute">
        Glossary table could not be read from docs/WRITING.md §5.
      </div>
    );
  }
  return (
    <section>
      <p className="mb-4 max-w-[820px] text-md leading-[1.7] text-mute">
        Fixed per-locale rendering for core product terms (WRITING.md §5). Shared
        across UI, LLM prompts and marketing — sentence tone is free, but these
        terms follow the table.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[19%]" />
            <col className="w-[19%]" />
            <col className="w-[19%]" />
            <col className="w-[19%]" />
          </colgroup>
          <thead>
            <tr className="text-xs uppercase tracking-[0.14em] text-mute-soft">
              <th className="px-2 py-1.5 text-left font-semibold">Concept</th>
              <th className="px-2 py-1.5 text-left font-semibold">en</th>
              <th className="px-2 py-1.5 text-left font-semibold">ko</th>
              <th className="px-2 py-1.5 text-left font-semibold">ja</th>
              <th className="px-2 py-1.5 text-left font-semibold">th</th>
            </tr>
          </thead>
          <tbody>
            {data.glossary.map((g) => (
              <tr key={g.concept} className="border-t border-line-soft align-top">
                <td className="px-2 py-2 font-medium text-ink">{g.concept}</td>
                <td className="px-2 py-2 text-mute">{g.en}</td>
                <td className="px-2 py-2 text-mute">{g.ko}</td>
                <td className="px-2 py-2 text-mute">{g.ja}</td>
                <td className="px-2 py-2 text-mute">{g.th}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RulesView({ data }: { data: WritingSystemData }) {
  return (
    <section className="max-w-[820px] space-y-4">
      <p className="text-md leading-[1.7] text-mute">
        Writing conventions every user-facing string follows (WRITING.md). The
        full source of truth is docs/WRITING.md.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.rules.map((rule) => (
          <div
            key={rule.title}
            className="rounded-md border border-line bg-paper-soft p-4"
          >
            <div className="mb-1.5 text-md font-semibold text-ink">{rule.title}</div>
            <p className="text-sm leading-[1.65] text-mute">{rule.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
