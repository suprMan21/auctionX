import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Signed in, marketplace parked (VITE_FEATURE_MARKETPLACE unset in tests).
vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'a@b.co' }, initialized: true, signOut: vi.fn() }),
}));
vi.mock('@/features/notifications/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/lib/supabase', () => {
  // Any query chain answers "nothing": not an admin, no unread messages.
  const empty = { data: null, count: 0, error: null };
  const chain: object = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(empty);
        if (prop === 'single' || prop === 'maybeSingle') return async () => empty;
        return () => chain;
      },
    },
  );
  const channel: object = new Proxy({}, { get: () => () => channel });
  return { supabase: { from: () => chain, channel: () => channel, removeChannel: () => undefined } };
});

import { Header } from '@/components/navigation/Header';

describe('Header with the marketplace parked', () => {
  it('shows no auction Dashboard link, only My Seals', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).not.toContain('/dashboard');
    expect(links.map((a) => a.getAttribute('href'))).not.toContain('/my-listings');
    expect(within(document.body).queryByText('Dashboard')).toBeNull();
  });
});
