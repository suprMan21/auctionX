import { describe, it, expect } from 'vitest';
import { isTimeRange, timeRangeOf } from './timeRange';

describe('audit time ranges (local days)', () => {
  const now = new Date(2026, 9, 26, 15, 30); // 26 Oct 2026, 3:30 pm local

  it('yesterday is the whole previous local day, to exclusive', () => {
    const { from, to } = timeRangeOf('yesterday', now);
    expect(new Date(from!).getTime()).toBe(new Date(2026, 9, 25).getTime());
    expect(new Date(to!).getTime()).toBe(new Date(2026, 9, 26).getTime());
  });

  it('today and the last 7 days end at the start of tomorrow', () => {
    expect(new Date(timeRangeOf('today', now).to!).getTime()).toBe(new Date(2026, 9, 27).getTime());
    expect(new Date(timeRangeOf('7d', now).from!).getTime()).toBe(new Date(2026, 9, 20).getTime());
  });

  it('any time sends no range; unknown values are refused', () => {
    expect(timeRangeOf('', now)).toEqual({});
    expect(isTimeRange('yesterday')).toBe(true);
    expect(isTimeRange('last-year')).toBe(false);
  });
});
