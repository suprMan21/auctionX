import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { OwnershipLookup } from '../api/schemas';
import { statusCopy } from '../lib/copy';
import { TokenStatusBadge } from '../components/TokenStatusBadge';
import { ProvenanceCard } from '../components/ProvenanceCard';

type Load =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; lookup: OwnershipLookup };

/**
 * `/ownership/:ownershipId` — public. An Ownership ID resolves to the token's
 * public page; a stale one says only that it is no longer current.
 */
export const OwnershipLookupPage = () => {
  const { ownershipId = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    tokenApi
      .lookupOwnership(ownershipId)
      .then((lookup) => {
        if (!cancelled) setLoad({ kind: 'ready', lookup });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof TokenApiError && err.status === 404) setLoad({ kind: 'not-found' });
        else setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => {
      cancelled = true;
    };
  }, [ownershipId]);

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <p className="text-xs text-gray-400 font-mono break-all">Ownership ID {ownershipId}</p>

        {load.kind === 'loading' && (
          <div role="status" className="glass rounded-2xl p-8 text-center text-gray-300">
            Looking up this Ownership ID…
          </div>
        )}
        {load.kind === 'not-found' && (
          <section className="glass rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Not found.</h1>
            <p className="text-gray-400">We have no record of this Ownership ID.</p>
          </section>
        )}
        {load.kind === 'error' && (
          <div role="alert" className="glass rounded-2xl p-8 text-center text-red-300">
            {load.message}
          </div>
        )}
        {load.kind === 'ready' && load.lookup.status === 'stale' && (
          <section className="glass rounded-2xl p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-2">No longer current.</h1>
            <p className="text-gray-400">This Ownership ID is no longer current.</p>
          </section>
        )}
        {load.kind === 'ready' && load.lookup.status === 'current' && (
          <>
            <section className="glass rounded-2xl p-8">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-white">
                  {load.lookup.youOwnThis ? 'You own this.' : 'Current ownership record.'}
                </h1>
                <TokenStatusBadge status={load.lookup.provenance?.lifecycle_status} />
              </div>
              <p className="text-gray-400">{statusCopy(load.lookup.provenance?.lifecycle_status).detail}</p>
            </section>
            <ProvenanceCard provenance={load.lookup.provenance} />
          </>
        )}
      </div>
    </main>
  );
};
