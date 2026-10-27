/**
 * Admin console UX-3 — a dashboard growth panel (Tokens or Accounts): two
 * tiles that open the matching list, and a chart with Month / Year / custom
 * time frames. Counts only; the server sends no emails or identifiers.
 */

import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { adminApi } from '../api/adminApi';
import type { GrowthKind, GrowthSeries } from '../api/growthSchemas';
import { errorMessage, loadFailed } from '../lib/display';
import { customRange, localDay, presetRange, viewerTimeZone, type GrowthPreset, type GrowthRange } from '../lib/growthRange';
import { GrowthChart } from './GrowthChart';
import { runningTotal, type ChartPoint } from '../lib/growthMath';

const COPY: Record<GrowthKind, { title: string; today: string; active: string; activeTo: string; todayTo: string; noun: string }> = {
  tokens: { title: 'Tokens', today: 'Added today', active: 'Active', activeTo: '/admin/tags?status=ACTIVE', todayTo: '/admin/tags', noun: 'Tokens' },
  accounts: { title: 'Accounts', today: 'New today', active: 'Active', activeTo: '/admin/users?status=active', todayTo: '/admin/users', noun: 'Accounts' },
};

const PRESETS: ReadonlyArray<{ value: GrowthPreset; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
];

const Tile = ({ label, value, to }: { label: string; value: number | null | undefined; to: string }) => (
  <Link
    to={to}
    className="glass rounded-2xl p-5 flex flex-col gap-1 hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
  >
    <span className="text-3xl font-semibold text-white tabular-nums">
      {value === undefined ? '…' : value === null ? 'Unavailable' : value.toLocaleString()}
    </span>
    <span className="text-sm text-gray-300">{label}</span>
  </Link>
);

const SEGMENT = 'min-h-[44px] px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

export const GrowthPanel = ({ kind }: { kind: GrowthKind }) => {
  const copy = COPY[kind];
  const [preset, setPreset] = useState<GrowthPreset>('month');
  const [range, setRange] = useState<GrowthRange>(() => presetRange('month'));
  const [draft, setDraft] = useState(() => ({ from: presetRange('month').from, to: localDay(new Date()) }));
  const [draftError, setDraftError] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'total'>('new');
  const queryKey = `${range.from}|${range.to}|${range.bucket}`;
  const [loaded, setLoaded] = useState<{ key: string; data: GrowthSeries } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const fromId = useId();
  const toId = useId();
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getGrowth({ series: kind, ...range, tz: viewerTimeZone() })
      .then((data) => { if (!cancelled) setLoaded({ key: queryKey, data }); })
      .catch((err) => { if (!cancelled) setFailure({ key: queryKey, message: errorMessage(err, loadFailed(copy.noun)) }); });
    return () => { cancelled = true; };
  }, [kind, range, queryKey, copy.noun]);

  // Tiles keep the last good numbers while a new time frame loads.
  const data = loaded?.data ?? null;
  const current = loaded?.key === queryKey ? loaded.data : null;
  const error = failure?.key === queryKey ? failure.message : null;
  const tileValue = (v: number | undefined) => (data ? v : error ? null : undefined);

  const choose = (p: GrowthPreset) => {
    setPreset(p);
    setDraftError(null);
    if (p !== 'custom') setRange(presetRange(p));
  };
  const applyCustom = () => {
    const r = customRange(draft.from, draft.to);
    if ('error' in r) { setDraftError(r.error); return; }
    setDraftError(null);
    setRange(r);
  };

  const per = range.bucket === 'month' ? 'month' : 'day';
  const chartLabel = mode === 'new' ? `${copy.noun} added per ${per}` : `${copy.noun} in total, by ${per}`;
  const points: ChartPoint[] = current
    ? mode === 'new' ? current.points.map((p) => ({ start: p.start, value: p.count })) : runningTotal(current)
    : [];

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold text-white">{copy.title}</h2>
      <div className="grid grid-cols-2 gap-4">
        <Tile label={copy.today} value={tileValue(data?.addedToday)} to={copy.todayTo} />
        <Tile label={copy.active} value={tileValue(data?.active)} to={copy.activeTo} />
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label={`${copy.title} time frame`} className="inline-flex rounded-xl bg-dark-700 overflow-hidden">
            {PRESETS.map((p) => (
              <button key={p.value} type="button" aria-pressed={preset === p.value} onClick={() => choose(p.value)}
                className={cn(SEGMENT, preset === p.value ? 'bg-primary-500/25 text-white' : 'text-gray-300 hover:text-white')}>
                {p.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label={`${copy.title} chart view`} className="inline-flex rounded-xl bg-dark-700 overflow-hidden">
            {(['new', 'total'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={cn(SEGMENT, mode === m ? 'bg-primary-500/25 text-white' : 'text-gray-300 hover:text-white')}>
                {m === 'new' ? 'New' : 'Total'}
              </button>
            ))}
          </div>
        </div>

        {preset === 'custom' && (
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); applyCustom(); }}>
            <div>
              <label htmlFor={fromId} className="block text-xs text-gray-400 mb-1">From</label>
              <input id={fromId} type="date" value={draft.from} max={draft.to || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                className="min-h-[44px] px-3 rounded-xl bg-dark-700 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label htmlFor={toId} className="block text-xs text-gray-400 mb-1">To</label>
              <input id={toId} type="date" value={draft.to} min={draft.from || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className="min-h-[44px] px-3 rounded-xl bg-dark-700 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <button type="submit" className="min-h-[44px] px-4 rounded-xl text-sm bg-primary-600 hover:bg-primary-500 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Show
            </button>
            <p className={cn('basis-full text-xs', draftError ? 'text-red-400' : 'text-gray-400')} role={draftError ? 'alert' : undefined}>
              {draftError ?? 'Up to 92 days shows each day; longer shows each month (at most 5 years).'}
            </p>
          </form>
        )}

        <h3 className="text-sm font-medium text-gray-200">{chartLabel}</h3>
        {error ? (
          <p role="alert" className="text-sm text-red-400">{error}</p>
        ) : !current ? (
          <div className="h-[200px] flex items-center justify-center" role="status" aria-label={`Loading ${copy.noun.toLowerCase()} chart`}>
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <GrowthChart points={points} bucket={current.bucket} mode={mode} label={chartLabel} />
        )}
      </div>
    </section>
  );
};
