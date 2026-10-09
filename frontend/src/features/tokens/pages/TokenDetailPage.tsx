import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { MyToken } from '../api/schemas';
import { statusCopy, transferErrorCopy } from '../lib/copy';
import { TokenStatusBadge } from '../components/TokenStatusBadge';
import { ProvenanceCard } from '../components/ProvenanceCard';
import { OwnershipPanel } from '../components/OwnershipPanel';
import { DisclosureSettings } from '../components/DisclosureSettings';
import { TransferInitiateDialog } from '../components/TransferInitiateDialog';
import { ReleaseTokenDialog } from '../components/ReleaseTokenDialog';
import { ReplacementSection } from '../components/ReplacementSection';
import { tokenDisplayName } from './MyTokensPage';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'missing' }
  | { kind: 'released' }
  | { kind: 'ready'; token: MyToken };

type Dialog = 'none' | 'transfer' | 'release';

/** `/tokens/:tagId` — one owned token: transfer, release, privacy, Ownership ID and Receipt. */
export const TokenDetailPage = () => {
  const { tagId = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [dialog, setDialog] = useState<Dialog>('none');

  const [reloadKey, setReloadKey] = useState(0);
  const refresh = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    tokenApi
      .myTokens()
      .then((tokens) => {
        if (cancelled) return;
        const token = tokens.find((t) => t.tagId === tagId);
        setLoad((current) =>
          token ? { kind: 'ready', token } : current.kind === 'released' ? current : { kind: 'missing' },
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      });
    return () => {
      cancelled = true;
    };
  }, [tagId, reloadKey]);

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
        {load.kind === 'released' && (
          <div className="glass rounded-2xl p-8 text-center" role="status">
            <h1 className="text-2xl font-bold text-white mb-2">Released.</h1>
            <p className="text-gray-400">This token is no longer valid. Every future tap will show it as released.</p>
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
            </section>

            <TransferSection
              token={load.token}
              onStartTransfer={() => setDialog('transfer')}
              onChanged={() => refresh()}
            />

            {load.token.ownershipId && <OwnershipPanel tagId={load.token.tagId} ownershipId={load.token.ownershipId} />}

            <DisclosureSettings
              tagId={load.token.tagId}
              disclosure={load.token.disclosure}
              provenance={load.token.provenance}
              onSaved={() => refresh()}
            />

            <ProvenanceCard provenance={load.token.provenance} />

            <ReplacementSection tagId={load.token.tagId} lifecycleStatus={load.token.lifecycleStatus} />

            {load.token.lifecycleStatus === 'ACTIVE' && (
              <section aria-labelledby="release-heading" className="rounded-2xl border border-red-500/30 p-6">
                <h2 id="release-heading" className="text-lg font-semibold text-white mb-2">
                  Release this token
                </h2>
                <p className="text-gray-400 text-sm mb-4">
                  Permanently retire the token. Nobody can claim it again. This cannot be undone.
                </p>
                {load.token.pendingTransfer ? (
                  <p className="text-amber-300 text-sm">Cancel the pending transfer before you release this token.</p>
                ) : (
                  <Button variant="secondary" onClick={() => setDialog('release')}>
                    Release token…
                  </Button>
                )}
              </section>
            )}

            <TransferInitiateDialog
              isOpen={dialog === 'transfer'}
              tagId={load.token.tagId}
              onClose={() => setDialog('none')}
              onStarted={() => {
                setDialog('none');
                refresh();
              }}
            />
            <ReleaseTokenDialog
              isOpen={dialog === 'release'}
              tagId={load.token.tagId}
              onClose={() => setDialog('none')}
              onReleased={() => {
                setDialog('none');
                setLoad({ kind: 'released' });
              }}
            />
          </>
        )}
      </div>
    </main>
  );
};

interface TransferSectionProps {
  readonly token: MyToken;
  readonly onStartTransfer: () => void;
  readonly onChanged: () => void;
}

type CancelState = { kind: 'idle' } | { kind: 'confirming' } | { kind: 'cancelling' } | { kind: 'error'; message: string };

const TransferSection = ({ token, onStartTransfer, onChanged }: TransferSectionProps) => {
  const [cancel, setCancel] = useState<CancelState>({ kind: 'idle' });
  const pending = token.pendingTransfer;

  if (token.lifecycleStatus !== 'ACTIVE') return null;

  const cancelTransfer = async () => {
    if (!pending) return;
    setCancel({ kind: 'cancelling' });
    try {
      await tokenApi.cancelTransfer(pending.transferId);
      setCancel({ kind: 'idle' });
      onChanged();
    } catch (err) {
      setCancel({
        kind: 'error',
        message: err instanceof TokenApiError ? transferErrorCopy(err) : 'Something went wrong. Please try again.',
      });
    }
  };

  return (
    <section aria-labelledby="transfer-heading" className="glass rounded-2xl p-6">
      <h2 id="transfer-heading" className="text-lg font-semibold text-white mb-2">
        Transfer
      </h2>
      {!pending ? (
        <>
          <p className="text-gray-400 text-sm mb-4">
            Sold it or giving it away? Start a transfer. Ownership moves when the recipient taps the token and pays the
            fee.
          </p>
          <Button onClick={onStartTransfer}>Transfer token…</Button>
        </>
      ) : (
        <>
          <p className="text-amber-300 text-sm mb-1">
            A {pending.transferType} to {pending.toEmail ?? 'another account'} is pending.
          </p>
          <p className="text-gray-400 text-sm mb-4">
            It completes when they tap the token and pay. Until then you can cancel it.
          </p>
          {cancel.kind === 'idle' && (
            <Button variant="secondary" onClick={() => setCancel({ kind: 'confirming' })}>
              Cancel transfer
            </Button>
          )}
          {(cancel.kind === 'confirming' || cancel.kind === 'cancelling') && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-gray-300 text-sm">Cancel this transfer?</span>
              <Button
                variant="secondary"
                onClick={cancelTransfer}
                disabled={cancel.kind === 'cancelling'}
                aria-busy={cancel.kind === 'cancelling'}
              >
                {cancel.kind === 'cancelling' ? 'Cancelling…' : 'Yes, cancel it'}
              </Button>
              <Button variant="ghost" onClick={() => setCancel({ kind: 'idle' })} disabled={cancel.kind === 'cancelling'}>
                Keep it
              </Button>
            </div>
          )}
          {cancel.kind === 'error' && (
            <p role="alert" className="text-red-300 text-sm">
              {cancel.message}
            </p>
          )}
        </>
      )}
    </section>
  );
};
