import { useState } from 'react';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { stripePromise } from '@/lib/stripe';
import { api } from '@/lib/api';

interface PaymentFormProps {
  amountCents: number;
  currency: string;
  listingId: string;
  onSuccess: (transactionId: string) => void;
  onCancel?: () => void;
}

function InnerForm({ amountCents, currency, listingId, onSuccess, onCancel }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? 'Could not validate payment details');
        return;
      }

      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({ elements });
      if (pmError || !paymentMethod) {
        setError(pmError?.message ?? 'Could not create payment method');
        return;
      }

      const result = await api.processPayment({
        amountCents,
        currency,
        paymentMethodId: paymentMethod.id,
        listingId,
      });

      onSuccess(result.transactionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amountCents / 100);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'tabs',
          wallets: { applePay: 'never', googlePay: 'never' },
        }}
      />

      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400
                   disabled:opacity-50 disabled:cursor-not-allowed
                   text-white font-semibold py-3 px-6 rounded-xl transition-all"
      >
        {submitting ? 'Processing…' : `Pay ${formattedAmount}`}
      </button>

      {onCancel && !submitting && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-gray-400 hover:text-gray-200 text-sm py-2 transition-colors"
        >
          Cancel
        </button>
      )}

      <p className="text-xs text-gray-500 text-center">
        Test card: 4242 4242 4242 4242 · any future expiry · any CVC · any ZIP
      </p>
    </form>
  );
}

export function PaymentForm(props: PaymentFormProps) {
  const options: StripeElementsOptions = {
    mode: 'payment',
    amount: props.amountCents,
    currency: props.currency.toLowerCase(),
    paymentMethodCreation: 'manual',
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#7c3aed',
        colorBackground: '#1a1a24',
        colorText: '#ffffff',
        colorDanger: '#ef4444',
        fontFamily: 'system-ui, sans-serif',
        borderRadius: '12px',
      },
    },
  };

  return (
    <Elements stripe={stripePromise} options={options}>
      <InnerForm {...props} />
    </Elements>
  );
}
