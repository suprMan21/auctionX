/** Admin console UX-3 — numbers behind the dashboard growth charts. */

import type { GrowthSeries } from '../api/growthSchemas';

export interface ChartPoint {
  start: string;
  value: number;
}

/** A clean top for the y-axis and its tick step (1, 2 or 5 × 10^n). */
export const niceScale = (max: number, ticks = 4): { top: number; step: number } => {
  if (max <= 0) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const intStep = Math.max(1, Math.round(step));
  return { top: Math.ceil(max / intStep) * intStep, step: intStep };
};

/** Running total: the count before the range plus each period's new ones. */
export const runningTotal = (series: GrowthSeries): ChartPoint[] => {
  let total = series.totalBefore;
  return series.points.map((p) => ({ start: p.start, value: (total += p.count) }));
};
