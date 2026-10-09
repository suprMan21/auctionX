import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('@/features/auth/hooks/useAuth', () => ({ useAuth: () => ({ user: null, initialized: true }) }));

import { HomePage, CONTACT_EMAIL } from './HomePage';

/**
 * The public home page is what partners and suppliers see first. These tests
 * hold it to the brand rules (Notion Brand Voice + Pitches v2.0 + Locked
 * decisions) so a later edit cannot quietly leak detail or break voice.
 */

const renderHome = () => render(<MemoryRouter><HomePage /></MemoryRouter>);

// Consumer copy says "seal"; no chip, security, money or parked-brand detail.
const FORBIDDEN = [
  /\btokens?\b/i, /\bNFTs?\b/i, /blockchain/i, /crypto/i, /\bNTAG\b/i, /\bKMS\b/i, /\bNXP\b/i,
  /auction/i, /\bbid\b/i, /marketplace/i, /unmentionables/i,
  /cannot be copied/i, /uncopyable/i, /worth more/i, /increase in value/i, /every item (verified|authenticated)/i,
];

describe('HomePage', () => {
  it('shows the locked headlines', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: /sealed with a story\./i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /look for it\. tap it\. keep it\./i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /why the seal matters\./i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /work with us\./i })).toBeInTheDocument();
  });

  it('keeps to the brand rules: no em dashes, no forbidden words', () => {
    const { container } = renderHome();
    const text = container.textContent ?? '';
    expect(text).not.toContain('—');
    for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  });

  it('offers a plain email contact and nothing that leads into the app', () => {
    renderHome();
    const mailtos = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('mailto:'));
    expect(mailtos.length).toBeGreaterThanOrEqual(3);
    for (const a of mailtos) expect(a.getAttribute('href')).toMatch(new RegExp(`^mailto:${CONTACT_EMAIL}\\?subject=`));
    // The only in-app link is the wordmark home link: no login, browse or parked pages.
    const internal = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/'));
    expect(internal.map((a) => a.getAttribute('href'))).toEqual(['/']);
  });

  it('has no axe violations', async () => {
    const { container } = renderHome();
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('describes the site the same way in index.html (title, link previews)', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toContain('<title>Authentic Materials | Sealed with a story</title>');
    expect(html).not.toContain('—');
    for (const pattern of FORBIDDEN) expect(html).not.toMatch(pattern);
    // No image tag pointing at an asset that does not exist.
    expect(html).not.toMatch(/og:image|twitter:image/);
  });
});
