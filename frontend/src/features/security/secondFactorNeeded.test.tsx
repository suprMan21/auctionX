import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MfaStatus } from './api/mfaApi';
import { useMfaStore } from './store/mfaStore';
import { SecondFactorNeeded } from './components/SecondFactorNeeded';

/** S-2FA Ph4: what a collector sees when a token action needs two-step sign-in. */

const at = '/tokens/abc?x=1';
const renderAt = () =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <SecondFactorNeeded />
    </MemoryRouter>,
  );

const seed = (hasFactor: boolean | null) =>
  useMfaStore.setState({ status: hasFactor === null ? null : ({ hasFactor } as unknown as MfaStatus) });

beforeEach(() => seed(null));

describe('SecondFactorNeeded', () => {
  it('no method yet: links to setup and comes back here', () => {
    seed(false);
    renderAt();
    const link = screen.getByRole('link', { name: 'Set up two-step sign-in' });
    expect(link).toHaveAttribute('href', `/settings/security/setup?next=${encodeURIComponent(at)}`);
  });

  it('status not loaded: treated as no method (setup still asks for a method)', () => {
    renderAt();
    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' })).toBeInTheDocument();
  });

  it('has a method: links to the sign-in second step', () => {
    seed(true);
    renderAt();
    const link = screen.getByRole('link', { name: 'Confirm it’s you' });
    expect(link).toHaveAttribute('href', `/sign-in/verify?next=${encodeURIComponent(at)}`);
  });
});
