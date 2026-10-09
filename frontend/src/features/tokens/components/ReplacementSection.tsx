import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { OwnerReissue } from '../api/schemas';
import { isOpenReissue, REISSUE_STAGE_COPY, reissueStage } from '../lib/reissue';

interface ReplacementSectionProps {
  readonly tagId: string;
  readonly lifecycleStatus: string | null;
}

type Load = { kind: 'loading' } | { kind: 'ready'; open: OwnerReissue | null } | { kind: 'error' };

/**
 * Token page: where a replacement-chip request stands (S-ADMIN1 Ph2), or how to
 * start one. Starting needs a live tap of the chip, so it begins on the verify
 * page, not here.
 */
export const ReplacementSection = ({ tagId, lifecycleStatus }: ReplacementSectionProps) => {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    tokenApi
      .myReissueRequests()
      .then((requests) => {
        if (!cancelled) setLoad({ kind: 'ready', open: requests.find((r) => r.tagId === tagId && isOpenReissue(r)) ?? null });
      })
      .catch(() => { if (!cancelled) setLoad({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [tagId, reloadKey]);

  if (load.kind !== 'ready') return null;
  const open = load.open;
  if (!open && lifecycleStatus !== 'ACTIVE') return null;

  const cancel = async () => {
    if (!open) return;
    setCancelling(true);
    setError(null);
    try {
      await tokenApi.cancelReissue(open.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof TokenApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section aria-labelledby="replacement-heading" className="glass rounded-2xl p-6">
      <h2 id="replacement-heading" className="text-lg font-semibold text-white mb-2">
        {open ? REISSUE_STAGE_COPY[reissueStage(open)].title : 'Chip coming loose?'}
      </h2>
      {open ? (
        <>
          <p className="text-gray-400 text-sm mb-4">{REISSUE_STAGE_COPY[reissueStage(open)].body}</p>
          <div className="flex flex-wrap items-center gap-3">
            {reissueStage(open) === 'pay' && (
              <Link
                to={`/tokens/reissue/${open.id}/pay`}
                className="inline-flex items-center px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                Pay the replacement fee
              </Link>
            )}
            {(reissueStage(open) === 'review' || reissueStage(open) === 'pay') && (
              <Button variant="ghost" onClick={cancel} disabled={cancelling} aria-busy={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel request'}
              </Button>
            )}
          </div>
          {error && <p role="alert" className="text-red-300 text-sm mt-3">{error}</p>}
        </>
      ) : (
        <p className="text-gray-400 text-sm">
          If the chip is lifting but still on the item, we can move your token to a new chip. Tap the chip with your
          phone and choose “Chip coming loose?” on the page that opens. We cannot replace a chip that has already come
          off.
        </p>
      )}
    </section>
  );
};
