import { useId, useState } from 'react';
import { z } from 'zod';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { TransferInitiateResult } from '../api/schemas';
import { formatMoney, transferErrorCopy } from '../lib/copy';

/** The fee the API charges per transfer (TRANSFER_FEE_CENTS). Display only. */
const LIST_FEE_USD_CENTS = 250;

const emailSchema = z.string().trim().email();

interface TransferInitiateDialogProps {
  readonly isOpen: boolean;
  readonly tagId: string;
  readonly onClose: () => void;
  readonly onStarted: (result: TransferInitiateResult) => void;
}

type Phase = { kind: 'editing' } | { kind: 'submitting' } | { kind: 'error'; message: string };

/**
 * Owner starts a sale or gift by recipient email. The recipient finishes it by
 * tapping the token and paying the transfer fee.
 */
export const TransferInitiateDialog = ({ isOpen, tagId, onClose, onStarted }: TransferInitiateDialogProps) => {
  const [transferType, setTransferType] = useState<'sale' | 'gift'>('sale');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const emailId = useId();
  const emailHelpId = useId();
  const emailErrorId = useId();

  const submitting = phase.kind === 'submitting';

  const close = () => {
    if (submitting) return;
    setPhase({ kind: 'editing' });
    setEmailError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError('Enter the email address of the person receiving the token.');
      return;
    }
    setEmailError(null);
    setPhase({ kind: 'submitting' });
    try {
      const result = await tokenApi.initiateTransfer({ tagId, transferType, toEmail: parsed.data.toLowerCase() });
      setPhase({ kind: 'editing' });
      setEmail('');
      onStarted(result);
    } catch (err) {
      setPhase({
        kind: 'error',
        message:
          err instanceof TokenApiError
            ? transferErrorCopy(err)
            : 'Something went wrong. Please try again.',
      });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Transfer this token">
      <form onSubmit={submit} noValidate className="space-y-5">
        <fieldset>
          <legend className="text-sm font-semibold text-white mb-2">What kind of transfer?</legend>
          <div className="space-y-2">
            {(['sale', 'gift'] as const).map((type) => (
              <label key={type} className="flex items-start gap-3 glass rounded-xl p-3 cursor-pointer">
                <input
                  type="radio"
                  name="transferType"
                  value={type}
                  checked={transferType === type}
                  onChange={() => setTransferType(type)}
                  className="mt-1 accent-primary-500"
                />
                <span>
                  <span className="block text-white">{type === 'sale' ? 'Sale' : 'Gift'}</span>
                  <span className="block text-gray-400 text-sm">
                    {type === 'sale'
                      ? 'You sold the item. Settle the price with the buyer yourself.'
                      : 'You are giving the item away.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={emailId} className="block text-sm font-semibold text-white mb-1">
            Recipient email
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${emailHelpId} ${emailErrorId}` : emailHelpId}
            className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p id={emailHelpId} className="text-gray-400 text-xs mt-1">
            They sign in with this address to accept. They do not need an account yet.
          </p>
          {emailError && (
            <p id={emailErrorId} role="alert" className="text-red-300 text-sm mt-1">
              {emailError}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/10 p-4 text-sm text-gray-300 space-y-1">
          <p>
            Transfer fee: <span className="text-white">{formatMoney(LIST_FEE_USD_CENTS, 'usd')}</span>, paid by the recipient
            when they accept.
          </p>
          <p className="text-gray-400">
            To accept, they tap the token with their phone. Hand over the item first. Ownership moves only when they
            tap and pay.
          </p>
          <p className="text-gray-400">You cannot release the token while the transfer is pending. You can cancel it.</p>
        </div>

        {phase.kind === 'error' && (
          <p role="alert" className="text-red-300 text-sm">
            {phase.message}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Starting…' : 'Start transfer'}
          </Button>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
};
