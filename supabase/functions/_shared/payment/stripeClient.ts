import Stripe from 'npm:stripe@17.5.0';

let cached: Stripe | null = null;

/**
 * Returns a process-wide singleton Stripe client. Pinned to the same
 * apiVersion as StripeProcessor so Connect Transfer responses match
 * the rest of the payment surface.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  cached = new Stripe(secretKey, {
    apiVersion: '2024-12-18.acacia',
    timeout: 30000,
  });
  return cached;
}
