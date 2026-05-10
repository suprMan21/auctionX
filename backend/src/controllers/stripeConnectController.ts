import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { getStripe } from '../lib/stripe';

interface ConnectRequest extends RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

type ConnectStatus = 'not_started' | 'pending' | 'active' | 'restricted';

interface UserConnectColumns {
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
  stripe_connect_onboarding_started_at: string | null;
}

function deriveStatus(
  accountId: string | null,
  chargesEnabled: boolean,
  payoutsEnabled: boolean,
  disabledReason: string | null,
): ConnectStatus {
  if (!accountId) return 'not_started';
  if (chargesEnabled && payoutsEnabled) return 'active';
  if (disabledReason) return 'restricted';
  return 'pending';
}

/**
 * POST /api/v1/stripe-connect/onboarding-link
 * Creates an Express account if the seller doesn't have one yet, then
 * returns a fresh Account Link URL for Stripe-hosted onboarding.
 * Account Links expire in minutes — re-create on every call rather than caching.
 */
export const createOnboardingLink = async (req: ConnectRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    const email = req.user?.email;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();
    const stripe = getStripe();

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('stripe_connect_account_id')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      logger.error('connect_onboarding_user_lookup_failed', { userId, error: fetchError });
      throw new AppError('not_found', 'User not found');
    }

    let accountId = (user as { stripe_connect_account_id: string | null }).stripe_connect_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        email: email ?? undefined,
        capabilities: { transfers: { requested: true } },
        metadata: { userId },
      });
      accountId = account.id;

      const { error: updateError } = await supabase
        .from('users')
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_onboarding_started_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (updateError) {
        logger.error('connect_onboarding_persist_failed', { userId, accountId, error: updateError });
        throw new AppError('internal', 'Failed to persist Stripe Connect account');
      }
      logger.info('connect_account_created', { userId, accountId });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${frontendUrl}/settings/payouts?refresh=1`,
      return_url: `${frontendUrl}/settings/payouts?return=1`,
      type: 'account_onboarding',
    });

    logger.info('connect_onboarding_link_created', { userId, accountId });
    return res.json({ success: true, data: { url: link.url } });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    logger.error('connect_onboarding_unexpected', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/stripe-connect/status
 * Returns the seller's Connect onboarding state. If the stored flags are
 * still false but onboarding was started, lazily refresh them via
 * stripe.accounts.retrieve as a fallback in case the webhook was missed.
 */
export const getConnectStatus = async (req: ConnectRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_onboarding_started_at')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      throw new AppError('not_found', 'User not found');
    }

    const cols = user as UserConnectColumns;
    let chargesEnabled = !!cols.stripe_connect_charges_enabled;
    let payoutsEnabled = !!cols.stripe_connect_payouts_enabled;
    let disabledReason: string | null = null;
    const accountId = cols.stripe_connect_account_id;

    if (accountId && (!chargesEnabled || !payoutsEnabled)) {
      try {
        const stripe = getStripe();
        const account = await stripe.accounts.retrieve(accountId);
        const freshCharges = !!account.charges_enabled;
        const freshPayouts = !!account.payouts_enabled;
        disabledReason = account.requirements?.disabled_reason ?? null;

        if (freshCharges !== chargesEnabled || freshPayouts !== payoutsEnabled) {
          await supabase
            .from('users')
            .update({
              stripe_connect_charges_enabled: freshCharges,
              stripe_connect_payouts_enabled: freshPayouts,
            })
            .eq('id', userId);
          logger.info('connect_status_lazy_refreshed', { userId, freshCharges, freshPayouts });
        }
        chargesEnabled = freshCharges;
        payoutsEnabled = freshPayouts;
      } catch (refreshErr) {
        // Non-fatal — fall through to stored values
        logger.warn('connect_status_refresh_failed', {
          userId,
          accountId,
          error: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
        });
      }
    }

    const status = deriveStatus(accountId, chargesEnabled, payoutsEnabled, disabledReason);

    return res.json({
      success: true,
      data: {
        status,
        accountId,
        chargesEnabled,
        payoutsEnabled,
        disabledReason,
        onboardingStartedAt: cols.stripe_connect_onboarding_started_at,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * Internal helper used by the account.updated webhook handler to apply
 * Stripe-reported account state to the matching user row.
 * Exposed for unit tests; not mounted as a route.
 */
export async function applyAccountUpdate(account: Stripe.Account): Promise<{ updated: boolean }> {
  const supabase = getServiceClient();
  const { error, count } = await supabase
    .from('users')
    .update({
      stripe_connect_charges_enabled: !!account.charges_enabled,
      stripe_connect_payouts_enabled: !!account.payouts_enabled,
    }, { count: 'exact' })
    .eq('stripe_connect_account_id', account.id);

  if (error) throw error;
  return { updated: (count ?? 0) > 0 };
}
