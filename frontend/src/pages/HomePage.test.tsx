import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { HomePage, CONTACT_EMAIL, SAMPLE_SEAL_CODE } from './HomePage';
import { CONSENT_TEXT, SignupProblem } from '@/components/home/EarlyAccessForm';
import { SealBadge } from '@/components/seal/SealBadge';

/**
 * The public homepage is the first thing anyone sees. These tests hold it to the Locked
 * "Story-first homepage" lines (S-SITE2 G1), the Brand Voice rules and the BPL-9 claims
 * matrix, so a later edit cannot quietly break voice, overclaim, or leak detail.
 */

const renderHome = (props: Parameters<typeof HomePage>[0] = {}) => render(<HomePage {...props} />);

// Consumer copy says "seal"; no chip, security, money or parked-brand detail.
const FORBIDDEN = [
  /\btokens?\b/i, /\bNFTs?\b/i, /blockchain/i, /crypto/i, /\bNTAG\b/i, /\bKMS\b/i, /\bNXP\b/i, /\bchips?\b/i,
  // "eBay, Marketplace" names where a seal travels; any other "marketplace" means the parked product.
  /auction/i, /\bbid\b/i, /(?<!eBay, )marketplace/i, /unmentionables/i,
  /worth more/i, /increase in value/i, /every item (verified|authenticated)/i,
];

// BPL-9: held until S-SEC1 exits clean, or never allowed.
const OVERCLAIMS = [
  /can'?t be (copied|cloned|moved)/i, /cannot be (copied|cloned|moved)/i, /uncopyable/i, /unhackable/i,
  /impossible to (copy|counterfeit|fake)/i, /guaranteed/i, /military-grade/i, /breaks for good/i,
  /clones get caught/i, /proves (it'?s|the item is) (real|authentic)/i, /independently (security )?tested/i,
];

// Unreleased seal names must not ship (the family shows two wordless "Coming soon" cards).
const UNRELEASED = [/\borigin\b/i, /\bAM[\s-]*proof\b/i, /\bproof seal\b/i, /tag-(proof|origin)/i];

describe('HomePage', () => {
  it('shows the Locked story-first lines (G1)', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Sealed witha story$/i);
    expect(screen.getByText('Every piece has a moment.')).toBeInTheDocument();
    for (const name of [
      'The moment, the item, the story sealed as proof',
      'Owners change, the story stays for life',
      'Seal the moment',
      'The original stays protected',
      'Look for the seal',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Proof of the source')).toBeInTheDocument();
  });

  it('drops the retired lines', () => {
    const { container } = renderHome();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/look for it\.? tap it\.? keep it/i);
    expect(text).not.toMatch(/work with us/i);
  });

  it('keeps titles free of periods', () => {
    renderHome();
    for (const h of screen.getAllByRole('heading')) expect(h.textContent?.trim()).not.toMatch(/\.$/);
  });

  it('keeps to the brand rules: no em dashes, no forbidden words', () => {
    const { container } = renderHome();
    const text = container.textContent ?? '';
    expect(text).not.toContain('—');
    for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  });

  it('makes no claim the claims matrix holds back (BPL-9)', () => {
    const { container } = renderHome();
    const text = container.textContent ?? '';
    for (const pattern of OVERCLAIMS) expect(text).not.toMatch(pattern);
    expect(text).toContain('designed to resist copying');
  });

  it('shows no unreleased seal names, in text or accessible names', () => {
    const { container } = renderHome();
    const labels = [...container.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')).join(' ');
    for (const pattern of UNRELEASED) {
      expect(container.textContent ?? '').not.toMatch(pattern);
      expect(labels).not.toMatch(pattern);
    }
    expect(screen.getAllByText('Coming soon')).toHaveLength(2);
  });

  it('has no placeholder brackets or real names (G2)', () => {
    const { container } = renderHome();
    const labels = [...container.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label')).join(' ');
    expect(container.textContent ?? '').not.toMatch(/\[[^\]]*\]/);
    expect(labels).not.toMatch(/\[[^\]]*\]/);
    for (const by of ['Sealed by the captain', 'Sealed by the artist', 'Sealed by the painter']) {
      expect(screen.getByText(by)).toBeInTheDocument();
    }
    expect(screen.getByText('Example screen')).toBeInTheDocument();
  });

  it('shows only a sample seal code on seals, never a serial, chip name or UID', () => {
    const { container } = renderHome();
    const badges = container.querySelectorAll('[data-seal-badge]');
    expect(badges.length).toBeGreaterThanOrEqual(3);
    for (const b of badges) {
      expect(b.textContent).toContain(SAMPLE_SEAL_CODE);
      expect(b.textContent).not.toMatch(/chip_|\b[0-9A-F]{14}\b|\bsn=|serial/i);
    }
    expect(container.textContent ?? '').not.toMatch(/\b04[0-9A-F]{12}\b/);
  });

  it('turns off the seal animations under reduced motion', () => {
    const css = readFileSync(resolve(__dirname, '../components/seal/seal.css'), 'utf8');
    const rule = css.match(/@media \(prefers-reduced-motion:\s*reduce\)\{([^}]*\})\}/);
    expect(rule?.[1]).toMatch(/\.sealbadge/);
    expect(rule?.[1]).toMatch(/\.sealspin/);
    expect(rule?.[1]).toMatch(/animation:\s*none/);
  });

  it('links only within the page, plus a plain email contact (G4: no legal links yet)', () => {
    renderHome();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    for (const href of hrefs) expect(href).toMatch(new RegExp(`^(#[a-z-]+|mailto:${CONTACT_EMAIL})$`));
    expect(hrefs).toContain(`mailto:${CONTACT_EMAIL}`);
    expect(screen.queryByRole('link', { name: /privacy|terms|biometric|health data|sign in/i })).toBeNull();
    // Every in-page link points at a section that exists.
    for (const href of hrefs.filter((h) => h.startsWith('#'))) {
      expect(document.getElementById(href.slice(1)), href).not.toBeNull();
    }
  });

  it('names no platform as a logo, only as plain text', () => {
    const { container } = renderHome();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByText('Instagram')).toBeInTheDocument();
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
    for (const pattern of [...FORBIDDEN, ...OVERCLAIMS]) expect(html).not.toMatch(pattern);
    expect(html).not.toMatch(/og:image|twitter:image/);
  });
});

describe('early-access form', () => {
  const fill = (value: string) => {
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Get early access' }));
  };

  it('sends the email with the exact consent wording shown on the page', async () => {
    const onEarlyAccess = vi.fn().mockResolvedValue(undefined);
    renderHome({ onEarlyAccess });
    expect(screen.getByText(CONSENT_TEXT)).toBeInTheDocument();
    fill('  fan@example.com ');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("You're on the list"));
    expect(onEarlyAccess).toHaveBeenCalledWith({
      email: 'fan@example.com',
      consentText: CONSENT_TEXT,
      website: '',
      fillMs: expect.any(Number),
    });
  });

  it('has a honeypot field people never see or reach', () => {
    const { container } = renderHome({ onEarlyAccess: vi.fn() });
    const hp = container.querySelector('input[name="website"]');
    expect(hp).not.toBeNull();
    expect(hp).toHaveAttribute('tabindex', '-1');
    expect(hp?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("shows the server's explanation when the email itself is the problem", async () => {
    renderHome({ onEarlyAccess: vi.fn().mockRejectedValue(new SignupProblem("That email can't receive mail. Check it and try again.")) });
    fill('fan@nowhere.test');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("That email can't receive mail"));
  });

  it('rejects a malformed email without calling out', () => {
    const onEarlyAccess = vi.fn();
    renderHome({ onEarlyAccess });
    fill('not-an-email');
    expect(screen.getByRole('alert')).toHaveTextContent(/does not look right/);
    expect(onEarlyAccess).not.toHaveBeenCalled();
  });

  it('says so when the signup fails, and never claims success', async () => {
    renderHome({ onEarlyAccess: vi.fn().mockRejectedValue(new Error('nope')) });
    fill('fan@example.com');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/went wrong/));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('SealBadge', () => {
  it('refuses anything that is not a seal code', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<SealBadge code="04A27E02936980" />)).toThrow(/seal code/);
    expect(() => render(<SealBadge code="chip_001" />)).toThrow(/seal code/);
  });

  it('is decorative unless given a label', () => {
    const { container, rerender } = render(<SealBadge code={SAMPLE_SEAL_CODE} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<SealBadge code={SAMPLE_SEAL_CODE} label="Genuine AM seal" />);
    expect(screen.getByRole('img', { name: 'Genuine AM seal' })).toBeInTheDocument();
  });

  it('gives every instance its own gradient so two badges never share ids', () => {
    const { container } = render(<><SealBadge code={SAMPLE_SEAL_CODE} /><SealBadge code={SAMPLE_SEAL_CODE} /></>);
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
