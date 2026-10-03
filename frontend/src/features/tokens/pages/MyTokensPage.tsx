import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { tokenApi } from '../api/tokenApi';
import type { IncomingTransfer, MyToken } from '../api/schemas';
import { TokenStatusBadge } from '../components/TokenStatusBadge';
import { TransferProcessing } from '../components/TransferProcessing';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; tokens: MyToken[]; incoming: IncomingTransfer[] };

export const tokenDisplayName = (token: { title: string | null; tagId: string }): string =>
  token.title ?? `Token ${token.tagId.slice(0, 8).toUpperCase()}`;

const formatUsd = (cents: number): string =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);

/** `/tokens` — everything the signed-in account owns, plus transfers waiting for it. */
export const MyTokensPage = () => {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Stripe's return_url after a redirect-based payment: /tokens?transfer=<id>&redirect_status=…
  const [params] = useSearchParams();
  const returningTransferId = params.get('transfer');
  const redirectFailed = params.get('redirect_status') === 'failed';

  useEffect(() => {
    let cancelled = false;
    Promise.all([tokenApi.myTokens(), tokenApi.incomingTransfers()])
      .then(([tokens, incoming]) => {
        if (!cancelled) setLoad({ kind: 'ready', tokens, incoming });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold text-white">My Tokens</h1>
          <p className="text-gray-400 mt-1">Your collection. Only you can see who owns these.</p>
        </header>

        {returningTransferId && redirectFailed && (
          <div role="alert" className="glass rounded-2xl p-6 text-red-300">
            Your payment did not go through. Tap the token again to retry.
          </div>
        )}
        {returningTransferId && !redirectFailed && (
          <TransferProcessing
            transferId={returningTransferId}
            tagId={null}
            onCompleted={() => setReloadKey((k) => k + 1)}
          />
        )}

        {load.kind === 'loading' && (
          <div role="status" className="glass rounded-2xl p-8 text-center text-gray-300">
            Loading your tokens…
          </div>
        )}

        {load.kind === 'error' && (
          <div role="alert" className="glass rounded-2xl p-8 text-center text-red-300">
            {load.message}
          </div>
        )}

        {load.kind === 'ready' && (
          <>
            {load.incoming.length > 0 && (
              <section aria-labelledby="incoming-heading" className="space-y-3">
                <h2 id="incoming-heading" className="text-xl font-semibold text-white">
                  Waiting for you
                </h2>
                <ul className="space-y-3">
                  {load.incoming.map((t) => (
                    <li key={t.transferId} className="glass rounded-2xl p-5">
                      <p className="text-white font-semibold">
                        {t.transferType === 'gift' ? 'A token is being gifted to you.' : 'A token is being transferred to you.'}
                      </p>
                      <p className="text-gray-400 text-sm mt-1">
                        {/* fee_payer SELLER does not yet charge the sender (the recipient's
                            browser confirms the PaymentIntent), so never claim the sender pays. */}
                        {`Transfer fee: ${formatUsd(t.listAmountUsdCents)}, paid when you accept.`}{' '}
                        To accept, tap the token with your phone. Have the item in hand first.
                      </p>
                      {t.provenance?.creator_name && (
                        <p className="text-gray-300 text-sm mt-2">Creator: {t.provenance.creator_name}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="owned-heading" className="space-y-3">
              <h2 id="owned-heading" className="text-xl font-semibold text-white">
                Owned
              </h2>
              {load.tokens.length === 0 ? (
                <div className="glass rounded-2xl p-8 text-center">
                  <p className="text-white font-semibold mb-1">No tokens yet.</p>
                  <p className="text-gray-400 text-sm">
                    Tap an unclaimed token with your phone to claim it. It will show up here.
                  </p>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {load.tokens.map((token) => (
                    <li key={token.tagId}>
                      <Link
                        to={`/tokens/${token.tagId}`}
                        className="block glass rounded-2xl p-5 hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-white font-semibold">{tokenDisplayName(token)}</p>
                          <TokenStatusBadge status={token.lifecycleStatus} />
                        </div>
                        {token.claimedAt && (
                          <p className="text-gray-400 text-sm mt-2">
                            Owned since {new Date(token.claimedAt).toLocaleDateString()}
                          </p>
                        )}
                        {token.pendingTransfer && (
                          <p className="text-amber-300 text-sm mt-2">Transfer pending</p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
};
