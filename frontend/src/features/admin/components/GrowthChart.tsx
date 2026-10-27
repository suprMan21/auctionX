/**
 * Admin console UX-3 — one-series growth chart, hand-drawn SVG (no chart
 * library). "New" shows columns per day or month; "Total" a running-total
 * line. Follows the dataviz rules: thin marks, 4px rounded column tops, one
 * recessive grid, text in text colours (never the series colour), a hover
 * tooltip, and a table view so no value depends on hover or colour.
 * Series colour #8b5cf6 passed the palette validator on the dark card surface.
 *
 * Columns keep a minimum width (MIN_BAND): when the card is narrower than the
 * chart needs, the plot scrolls sideways instead of squeezing, the y-axis
 * stays pinned on the left, and the strip opens on the newest dates.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { GrowthBucket } from '../api/growthSchemas';
import { bucketLabel } from '../lib/growthRange';
import { niceScale, type ChartPoint } from '../lib/growthMath';

export const SERIES_COLOR = '#8b5cf6';
const SURFACE = '#1a1a24';
const GRID = 'rgba(255,255,255,0.08)';
const AXIS_TEXT = '#9ca3af'; // gray-400
/** Narrowest a day or month column may get before the plot scrolls instead. */
export const MIN_BAND = 16;
const AXIS_W = 40;

const compact = (n: number): string =>
  new Intl.NumberFormat(undefined, { notation: n >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);

const useWidth = (fallback: number) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
};

export const GrowthChart = ({
  points, bucket, mode, label,
}: {
  points: ChartPoint[];
  bucket: GrowthBucket;
  mode: 'new' | 'total';
  /** e.g. "Tokens added per day" — names the chart for screen readers and the table. */
  label: string;
}) => {
  // `width` is the visible width of the scroll strip; the plot may be wider.
  const { ref, width } = useWidth(560);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const height = 200;
  const pad = { top: 12, right: 12, bottom: 28, left: 6 };
  const n = Math.max(points.length, 1);
  const plotW = Math.max(width, n * MIN_BAND + pad.left + pad.right);
  const scrolls = plotW > width;
  const innerW = Math.max(plotW - pad.left - pad.right, 10);
  const innerH = height - pad.top - pad.bottom;
  const band = innerW / n;
  const max = Math.max(0, ...points.map((p) => p.value));
  const { top, step } = niceScale(max);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const cx = (i: number) => pad.left + band * i + band / 2;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  // X labels at least 64px apart (fits "Sep 28"), always the first and last;
  // a middle label too close to the last one is dropped so they never overlap.
  const MIN_GAP = 64;
  const every = Math.max(1, Math.ceil(MIN_GAP / band));
  const showX = (i: number) =>
    i === 0 || i === n - 1 || (i % every === 0 && (n - 1 - i) * band >= MIN_GAP && i * band >= MIN_GAP);

  const barW = Math.min(24, Math.max(band - 2, 1)); // 2px surface gap between touching bars
  const r = Math.min(4, barW / 2);
  const column = (i: number, v: number) => {
    const x = cx(i) - barW / 2;
    const yTop = y(v);
    const base = y(0);
    if (v <= 0) return '';
    const rr = Math.min(r, base - yTop);
    return `M${x},${base}V${yTop + rr}Q${x},${yTop} ${x + rr},${yTop}H${x + barW - rr}Q${x + barW},${yTop} ${x + barW},${yTop + rr}V${base}Z`;
  };
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${y(p.value)}`).join('');
  const areaPath = points.length ? `${linePath}L${cx(points.length - 1)},${y(0)}L${cx(0)},${y(0)}Z` : '';
  const last = points.length - 1;
  const hovered = hover !== null ? points[hover] : null;

  // Open on the newest dates; again whenever the data or the strip width changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [ref, points, plotW]);

  return (
    <div className="space-y-2">
      <div className="flex" onPointerLeave={() => setHover(null)}>
        {/* Y-axis, pinned: it does not scroll with the plot. */}
        <svg width={AXIS_W} height={height} aria-hidden="true" className="flex-shrink-0">
          {ticks.map((t) => (
            <text key={t} x={AXIS_W - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>{compact(t)}</text>
          ))}
        </svg>
        <div
          ref={ref}
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          // Keyboard users can scroll the strip with the arrow keys once it scrolls.
          tabIndex={scrolls ? 0 : undefined}
          role={scrolls ? 'group' : undefined}
          aria-label={scrolls ? `${label}, scroll sideways for earlier dates` : undefined}
        >
          <div className="relative" style={{ width: plotW }}>
            <svg width={plotW} height={height} role="img" aria-labelledby={titleId} className="block">
              <title id={titleId}>{`${label}. The table below has every value.`}</title>
              {ticks.map((t) => (
                <line key={t} x1={0} x2={pad.left + innerW} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              ))}
              {points.map((p, i) =>
                showX(i) ? (
                  <text key={p.start} x={cx(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize={11} fill={AXIS_TEXT}
                    dx={i === 0 ? -Math.min(band / 2, 8) : i === last ? Math.min(band / 2, 8) : 0}>
                    {bucketLabel(p.start, bucket)}
                  </text>
                ) : null,
              )}

              {mode === 'new' ? (
                points.map((p, i) => (
                  <path key={p.start} d={column(i, p.value)} fill={SERIES_COLOR} opacity={hover === null || hover === i ? 1 : 0.55} />
                ))
              ) : (
                <>
                  <path d={areaPath} fill={SERIES_COLOR} opacity={0.1} />
                  <path d={linePath} fill="none" stroke={SERIES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {last >= 0 && (
                    <>
                      <circle cx={cx(last)} cy={y(points[last].value)} r={6} fill={SURFACE} />
                      <circle cx={cx(last)} cy={y(points[last].value)} r={4} fill={SERIES_COLOR} />
                    </>
                  )}
                  {hover !== null && hover !== last && (
                    <>
                      <circle cx={cx(hover)} cy={y(points[hover].value)} r={6} fill={SURFACE} />
                      <circle cx={cx(hover)} cy={y(points[hover].value)} r={4} fill={SERIES_COLOR} />
                    </>
                  )}
                </>
              )}
              {hover !== null && mode === 'total' && (
                <line x1={cx(hover)} x2={cx(hover)} y1={pad.top} y2={y(0)} stroke="rgba(255,255,255,0.25)" strokeWidth={1} />
              )}

              {/* Hit targets: the whole column band, wider than the mark. */}
              {points.map((p, i) => (
                <rect key={p.start} x={pad.left + band * i} y={pad.top} width={band} height={innerH}
                  fill="transparent" onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} />
              ))}
            </svg>

            {hovered && hover !== null && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-10 rounded-xl bg-dark-800 border border-white/10 px-3 py-2 text-xs shadow-lg whitespace-nowrap"
                style={{ left: Math.min(Math.max(cx(hover) - 60, 0), Math.max(plotW - 140, 0)) }}
              >
                <span className="block text-sm font-semibold text-white">{hovered.value.toLocaleString()}</span>
                <span className="text-gray-400">{bucketLabel(hovered.start, bucket, 'long')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {scrolls && <p className="text-xs text-gray-400">← Swipe or scroll for earlier dates</p>}

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-300 hover:text-white min-h-[44px] inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
          Show as table
        </summary>
        <div className="max-h-64 overflow-y-auto mt-2">
          <table className="w-full text-left">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr className="text-xs text-gray-400">
                <th scope="col" className="py-1 pr-4 font-medium">{bucket === 'month' ? 'Month' : 'Day'}</th>
                <th scope="col" className="py-1 font-medium text-right">{mode === 'new' ? 'Added' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.start} className="border-t border-white/5 text-gray-200">
                  <td className="py-1 pr-4">{bucketLabel(p.start, bucket, 'long')}</td>
                  <td className="py-1 text-right tabular-nums">{p.value.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};
