import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { SHARE_COPY } from '../lib/copy';

const api = vi.hoisted(() => ({ shareImage: vi.fn<(tagId: string) => Promise<Blob>>() }));

vi.mock('../api/tokenApi', async () => {
  const actual = await vi.importActual<typeof import('../api/tokenApi')>('../api/tokenApi');
  return { ...actual, tokenApi: { ...actual.tokenApi, shareImage: api.shareImage } };
});

import { SealShare } from './SealShare';
import { sealPageUrl } from '../lib/sealLink';

const TAG = '55555555-5555-4555-8555-555555555555';
const CODE = 'WAV4-F6TT';

type Nav = { share?: unknown; canShare?: unknown; clipboard?: unknown };
const nav = navigator as unknown as Nav;
const original = { share: nav.share, canShare: nav.canShare, clipboard: nav.clipboard };

const setNav = (over: Partial<Nav>) => {
  for (const [k, v] of Object.entries(over)) Object.defineProperty(navigator, k, { value: v, configurable: true, writable: true });
};

beforeEach(() => {
  api.shareImage.mockReset();
  setNav({ share: undefined, canShare: undefined, clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
  setNav(original);
  vi.restoreAllMocks();
});

describe('SealShare', () => {
  it('shows Share link and Share picture for a live seal', () => {
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    expect(screen.getByRole('button', { name: SHARE_COPY.shareLink })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SHARE_COPY.sharePicture })).toBeInTheDocument();
    expect(screen.getByText(SHARE_COPY.explainer)).toBeInTheDocument();
  });

  it.each(['SUSPENDED', 'RELEASED', 'RETIRED', null])('shows nothing for a %s seal', (status) => {
    const { container } = render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus={status} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing without a well-formed seal code', () => {
    const { container } = render(<SealShare tagId={TAG} sealCode={null} lifecycleStatus="ACTIVE" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('link points at this site\'s /s/ page', () => {
    expect(sealPageUrl(CODE)).toBe(`${window.location.origin}/s/WAV4-F6TT`);
  });

  it('Share link opens the share sheet with the link only', async () => {
    const share = vi.fn(async () => {});
    setNav({ share });
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.shareLink }));
    expect(share).toHaveBeenCalledWith({ url: sealPageUrl(CODE), title: 'Seal WAV4-F6TT' });
    expect(share.mock.calls[0]).not.toHaveProperty('0.files');
  });

  it('Share link copies the link when there is no share sheet, and says so', async () => {
    const writeText = vi.fn(async () => {});
    setNav({ clipboard: { writeText } });
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.shareLink }));
    expect(writeText).toHaveBeenCalledWith(sealPageUrl(CODE));
    expect(screen.getByRole('status')).toHaveTextContent(SHARE_COPY.linkCopied);
  });

  it('a cancelled share sheet is not an error and copies nothing', async () => {
    const writeText = vi.fn(async () => {});
    setNav({ share: vi.fn(async () => { throw new DOMException('cancel', 'AbortError'); }), clipboard: { writeText } });
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.shareLink }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows the link to copy by hand when the clipboard is refused', async () => {
    setNav({ clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.shareLink }));
    expect(screen.getByRole('status')).toHaveTextContent(`${SHARE_COPY.copyThisLink} ${sealPageUrl(CODE)}`);
  });

  it('Share picture shares the PNG as a file only', async () => {
    api.shareImage.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const share = vi.fn(async () => {});
    setNav({ share, canShare: vi.fn(() => true) });
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.sharePicture }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(api.shareImage).toHaveBeenCalledWith(TAG);
    const arg = (share.mock.calls[0] as unknown[])[0] as { files: File[]; url?: string };
    expect(arg.url).toBeUndefined();
    expect(arg.files[0].name).toBe('seal-WAV4-F6TT.png');
    expect(arg.files[0].type).toBe('image/png');
  });

  it('downloads the picture when files cannot be shared', async () => {
    api.shareImage.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.sharePicture }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SHARE_COPY.pictureSaved));
    expect(click).toHaveBeenCalled();
  });

  it('when Safari refuses the share sheet after the wait, keeps the picture and asks for one more tap', async () => {
    api.shareImage.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const share = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('no gesture', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    setNav({ share, canShare: vi.fn(() => true) });
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.sharePicture }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SHARE_COPY.pictureReady));
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.sharePicture }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(api.shareImage).toHaveBeenCalledTimes(1);
  });

  it('shows the server\'s message when the picture cannot be made', async () => {
    api.shareImage.mockRejectedValue(new Error('This seal cannot be shared right now'));
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    await userEvent.click(screen.getByRole('button', { name: SHARE_COPY.sharePicture }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('This seal cannot be shared right now'));
  });

  it('compact buttons name the seal for screen readers', () => {
    render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" compact />);
    expect(screen.getByRole('button', { name: 'Share link for seal WAV4-F6TT' })).toBeInTheDocument();
    expect(screen.queryByText(SHARE_COPY.explainer)).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<SealShare tagId={TAG} sealCode={CODE} lifecycleStatus="ACTIVE" />);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('copy says seal, never token / chip / NFT, and has no em dashes', () => {
    const all = Object.values(SHARE_COPY).join(' ');
    expect(all).not.toMatch(/token|chip|nft|mint|wallet/i);
    expect(all).not.toContain('—');
  });
});
