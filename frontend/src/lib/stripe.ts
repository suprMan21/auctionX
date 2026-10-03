import { loadStripe, type Appearance, type Stripe } from '@stripe/stripe-js';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const stripePromise: Promise<Stripe | null> = publishableKey
  ? loadStripe(publishableKey)
  : Promise.resolve(null);

/** False when no publishable key is configured: payments cannot load. */
export const isStripeConfigured: boolean = Boolean(publishableKey);

/** True when the configured key is a Stripe test key (shows the test-card hint). */
export const isStripeTestMode: boolean = typeof publishableKey === 'string' && publishableKey.startsWith('pk_test_');

/** Shared Elements appearance (dark design system). */
export const stripeAppearance: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#7c3aed',
    colorBackground: '#1a1a24',
    colorText: '#ffffff',
    colorDanger: '#ef4444',
    fontFamily: 'system-ui, sans-serif',
    borderRadius: '12px',
  },
};
