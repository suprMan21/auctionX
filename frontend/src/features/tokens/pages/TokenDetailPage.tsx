import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { tokenApi } from '../api/tokenApi';
import type { MyToken } from '../api/schemas';
import { statusCopy } from '../lib/copy';
import { TokenStatusBadge } from '../components/TokenStatusBadge';
import { ProvenanceCard } from '../components/ProvenanceCard';
import { tokenDisplayName } from './MyTokensPage';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }
  | { kind: 'ready'; token: MyToken };

const DISCLOSURE_LABELS: Record<string, string> = {
  creator_name: 'Creator name',
  claim_date: 'Claim date',
  location: 'Origin location',
  origin_video: 'Origin video',
};

/**
 * `/tokens/:tagId` — read-only in Phase 1. Transfer, release, privacy settings
 * and the Receipt download arrive in Phase 2.
 */
export const TokenDetailPage = () => {
  const { tagId = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tokenApi
      .myTokens()
      .then((tokens) => {
        if (cancelled) return;
        const token = tokens.find((t) => t.tagId === tagId);
        setLoad(token ? { kind: 'ready', token } : { kind: 'missing' });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => {
      cancelled = true;
    };
  }, [tagId]);

  const copyOwnershipId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/tokens" className="text-sm text-gray-400 hover:text-white">
          <span aria-hidden="true">← </span>My Tokens
        </Link>

        {load.kind === 'loading' && (
          <div role="status" className="glass rounded-2xl p-8 text-center text-gray-300">
            Loading token…
          </div>
        )}
        {load.kind === 'error' && (
          <div role="alert" className="glass rounded-2xl p-8 text-center text-red-300">
            {load.message}
          </div>
        )}
        {load.kind === 'missing' && (
          <div className="glass rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Not in your collection.</h1>
            <p className="text-gray-400">This token is not owned by your account.</p>
          </div>
        )}

        {load.kind === 'ready' && (
          <>
            <section className="glass rounded-2xl p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <h1 className="text-2xl font-bold text-white">{tokenDisplayName(load.token)}</h1>
                <TokenStatusBadge status={load.token.lifecycleStatus} />
              </div>
              <p className="text-gray-400">{statusCopy(load.token.lifecycleStatus).detail}</p>
              {load.token.pendingTransfer && (
                <p className="mt-3 text-amber-300 text-sm">
                  A {load.token.pendingTransfer.transferType} to{' '}
                  {load.token.pendingTransfer.toEmail ?? 'another account'} is pending.
                </p>
              )}
            </section>

            {load.token.ownershipId && (
              <section aria-labelledby="ownership-heading" className="glass rounded-2xl p-6">
                <h2 id="ownership-heading" className="text-lg font-semibold text-white mb-2">
                  Ownership ID
                </h2>
                <p className="text-gray-400 text-sm mb-3">
                  A public fingerprint of your ownership. It reveals nothing about you and never authorizes anything.
                </p>
                <p className="font-mono text-xs text-gray-300 break-all mb-4">{load.token.ownershipId}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={() => copyOwnershipId(load.token.ownershipId!)}
                    className="text-sm text-primary-300 underline hover:text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
                  >
                    Copy ID
                  </button>
                  <Link to={`/ownership/${load.token.ownershipId}`} className="text-sm text-primary-300 underline hover:text-primary-200">
                    Open public lookup
                  </Link>
                  <span aria-live="polite" className="text-sm text-emerald-300">
                    {copied ? 'Copied.' : ''}
                  </span>
                </div>
              </section>
            )}

            <section aria-labelledby="disclosure-heading" className="glass rounded-2xl p-6">
              <h2 id="disclosure-heading" className="text-lg font-semibold text-white mb-3">
                What the public page shows
              </h2>
              <ul className="text-sm space-y-1">
                {Object.entries(DISCLOSURE_LABELS).map(([key, label]) => (
                  <li key={key} className="flex justify-between">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-white">{load.token.disclosure[key] ? 'Shown' : 'Hidden'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-gray-400 text-xs mt-3">
                A detail shows only if the creator released it and you choose to show it. Settings arrive in the next update.
              </p>
            </section>

            <ProvenanceCard provenance={load.token.provenance} />
          </>
        )}
      </div>
    </main>
  );
};
