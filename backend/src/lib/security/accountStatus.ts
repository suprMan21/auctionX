/**
 * S-ADMIN2 Ph1 — is this account allowed to act?
 *
 * Suspend and Retire already ban sign-in and delete every session inside the
 * same database transaction. This is the second check: an access token issued
 * before the action is refused here too, so a suspended or retired account
 * cannot act on tokens even for the remaining life of that token (AC 2).
 * Public verification of a token does not pass through here and keeps working.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AccountStatus = 'active' | 'suspended' | 'retired';

let client: SupabaseClient | null = null;
const serviceClient = (): SupabaseClient => {
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return client;
};

/** Test seam. */
export const __setAccountStatusClient = (c: SupabaseClient | null): void => {
  client = c;
};

/**
 * The account's status, or null when it cannot be read. A missing profile row
 * reads as 'active' (the database function returns no row): sign-up creates
 * the row by trigger, and blocking on its absence would lock out new accounts.
 */
export const getAccountStatus = async (userId: string): Promise<AccountStatus | null> => {
  const { data, error } = await serviceClient().rpc('account_status_of', { p_user: userId });
  if (error) return null;
  return data === 'suspended' || data === 'retired' ? data : 'active';
};
