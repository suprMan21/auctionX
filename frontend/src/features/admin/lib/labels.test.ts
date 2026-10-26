import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditEntityLabel,
  healthComponentLabel,
  healthStatusLabel,
  lifecycleLabel,
  reissueStageLabel,
  sentenceCase,
} from './labels';
import { NONE, formatAmount, formatDay, formatWhen } from './display';

describe('admin labels', () => {
  it('names token states in plain words', () => {
    expect(lifecycleLabel('ENROLLED')).toBe('Ready to claim');
    expect(lifecycleLabel('RELEASED')).toBe('Released by owner');
    expect(lifecycleLabel(null)).toBe('Unknown');
  });

  it('names audit actions and types, falling back to sentence case', () => {
    expect(auditActionLabel('tag_search')).toBe('Token search');
    expect(auditActionLabel('role_grant')).toBe('Staff role granted');
    expect(auditActionLabel('delete_window_set')).toBe('Delete waiting time changed');
    expect(auditActionLabel('reset')).toBe('Token moved to new chip');
    expect(auditActionLabel('something_new_here')).toBe('Something new here');
    expect(auditEntityLabel('user')).toBe('Account');
    expect(auditEntityLabel('nfc_tag')).toBe('Token');
    expect(auditEntityLabel('admin_search')).toBe('Search');
  });

  it('names re-issue stages and system health', () => {
    expect(reissueStageLabel('APPROVED', 'PAID')).toBe('Paid, ready for a new chip');
    expect(reissueStageLabel('PENDING', null)).toBe('Waiting for review');
    expect(reissueStageLabel('APPROVED', 'PAID', true)).toBe('Done');
    expect(healthStatusLabel('degraded')).toBe('Slow');
    expect(healthComponentLabel('auth')).toBe('Sign-in');
  });

  it('sentence-cases codes', () => {
    expect(sentenceCase('session.completed')).toBe('Session completed');
    expect(sentenceCase('PAYMENT_REFUND')).toBe('Payment refund');
  });
});

describe('admin display helpers', () => {
  it('never shows an em dash for a missing value', () => {
    expect(formatWhen(null)).toBe(NONE);
    expect(formatDay(undefined)).toBe(NONE);
    expect(formatAmount(null)).toBe(NONE);
    expect(NONE).toBe('None');
  });

  it('formats cents as money in the viewer’s locale', () => {
    const expected = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(3);
    expect(formatAmount(300)).toBe(expected);
    expect(formatAmount(300, 'usd')).toBe(expected);
  });
});
