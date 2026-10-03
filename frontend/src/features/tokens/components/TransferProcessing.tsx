import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { tokenApi } from '../api/tokenApi';

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 60_000;

type Outcome = { kind: 'waiting' } | { kind: 'completed' } | { kind: 'ended'; status: string } | { kind: 'timeout' };

interface TransferProcessingProps {
  readonly transferId: string;
  /** The tag, for the "view it" link once it lands. */
  readonly tagId: string | null;
  readonly onCompleted?: () => void;
}

/**
 * After payment: polls GET /transfer/:id until the Stripe webhook moves it to
 * COMPLETED. The payment response is not proof of anything, so the UI says
 * "processing" until the server agrees.
 */
export const TransferProcessing = ({ transferId, tagId, onCompleted }: TransferProcessingProps) => {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'waiting' });
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const poll = async () => {
      try {
        const transfer = await tokenApi.transferStatus(transferId);
        if (stopped) return;
        if (transfer.status === 'COMPLETED') {
          setOutcome({ kind: 'completed' });
          onCompletedRef.current?.();
          return;
        }
        if (transfer.status !== 'PENDING') {
          setOutcome({ kind: 'ended', status: transfer.status });
          return;
        }
      } catch {
        // A failed poll is not a failed transfer; keep trying until the deadline.
        if (stopped) return;
      }
      if (Date.now() >= deadline) {
        setOutcome({ kind: 'timeout' });
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [transferId]);

  return (
    <section className="glass rounded-2xl p-6" aria-live="polite">
      {outcome.kind === 'waiting' && (
        <div role="status">
          <h2 className="text-lg font-semibold text-white mb-2">Payment received. Finishing the transfer…</h2>
          <p className="text-gray-400 text-sm">This usually takes a few seconds. You can keep this page open.</p>
        </div>
      )}
      {outcome.kind === 'completed' && (
        <>
          <h2 className="text-lg font-semibold text-white mb-2">It is yours.</h2>
          <p className="text-gray-400 text-sm mb-3">The transfer is complete and you are the owner on record.</p>
          <Link to={tagId ? `/tokens/${tagId}` : '/tokens'} className="text-primary-300 underline hover:text-primary-200">
            View it in My Tokens
          </Link>
        </>
      )}
      {outcome.kind === 'ended' && (
        <div role="alert">
          <h2 className="text-lg font-semibold text-white mb-2">This transfer did not go through.</h2>
          <p className="text-gray-400 text-sm">
            {outcome.status === 'CANCELLED'
              ? 'The sender cancelled it.'
              : 'It is no longer pending.'}{' '}
            If you were charged, contact support and we will sort it out.
          </p>
        </div>
      )}
      {outcome.kind === 'timeout' && (
        <>
          <h2 className="text-lg font-semibold text-white mb-2">Still finishing up.</h2>
          <p className="text-gray-400 text-sm">
            Your payment went through, but the transfer is taking longer than usual. Check{' '}
            <Link to="/tokens" className="text-primary-300 underline hover:text-primary-200">My Tokens</Link> in a few
            minutes. You do not need to pay again.
          </p>
        </>
      )}
    </section>
  );
};
