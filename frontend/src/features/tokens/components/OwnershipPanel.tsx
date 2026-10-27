import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import { downloadJson, receiptDocument, receiptFileName } from '../lib/receipt';

interface OwnershipPanelProps {
  readonly tagId: string;
  readonly ownershipId: string;
  /** S-ANCHOR1: null while pending; undefined when the backend predates anchoring. */
  readonly anchor?: { readonly anchoredAt: string; readonly explorerUrl: string | null } | null;
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

type ReceiptState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done' } | { kind: 'error'; message: string };

/** The public Ownership ID, plus the private Receipt that backs it. */
export const OwnershipPanel = ({ tagId, ownershipId, anchor }: OwnershipPanelProps) => {
  const [copied, setCopied] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptState>({ kind: 'idle' });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ownershipId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = async () => {
    setReceipt({ kind: 'loading' });
    try {
      const data = await tokenApi.receipt(tagId);
      downloadJson(receiptFileName(data), receiptDocument(tagId, data));
      setReceipt({ kind: 'done' });
    } catch (err) {
      setReceipt({
        kind: 'error',
        message: err instanceof TokenApiError ? err.message : 'We could not prepare your Receipt. Please try again.',
      });
    }
  };

  return (
    <section aria-labelledby="ownership-heading" className="glass rounded-2xl p-6">
      <h2 id="ownership-heading" className="text-lg font-semibold text-white mb-2">
        Ownership ID
      </h2>
      <p className="text-gray-400 text-sm mb-3">
        A public fingerprint of your ownership. It reveals nothing about you and never authorizes anything.
      </p>
      <p className="font-mono text-xs text-gray-300 break-all mb-4">{ownershipId}</p>
      {anchor !== undefined && (
        <p className="text-sm text-gray-300 mb-4" data-testid="ownership-anchor">
          {anchor ? (
            <>
              Recorded in the public registry on {formatDate(anchor.anchoredAt)}.{' '}
              {anchor.explorerUrl && (
                <a
                  href={anchor.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-300 underline hover:text-primary-200"
                >
                  Verify independently
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </>
          ) : (
            'Being added to the public registry. This happens once a day, so it can take up to 24 hours.'
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <button
          type="button"
          onClick={copy}
          className="text-sm text-primary-300 underline hover:text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
        >
          Copy ID
        </button>
        <Link to={`/ownership/${ownershipId}`} className="text-sm text-primary-300 underline hover:text-primary-200">
          Open public lookup
        </Link>
        <span aria-live="polite" className="text-sm text-emerald-300">
          {copied ? 'Copied.' : ''}
        </span>
      </div>

      <h3 className="text-white font-semibold mb-1">Receipt</h3>
      <p className="text-gray-400 text-sm mb-3">
        Your private proof that you held this ownership. Anyone with it can check the ID above, so keep it to
        yourself. It cannot move or claim the token.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={download} disabled={receipt.kind === 'loading'} aria-busy={receipt.kind === 'loading'}>
          {receipt.kind === 'loading' ? 'Preparing…' : 'Download Receipt'}
        </Button>
        <span role="status" className="text-sm text-emerald-300">
          {receipt.kind === 'done' ? 'Receipt downloaded.' : ''}
        </span>
      </div>
      {receipt.kind === 'error' && (
        <p role="alert" className="text-red-300 text-sm mt-3">
          {receipt.message}
        </p>
      )}
    </section>
  );
};
