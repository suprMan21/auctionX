import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EarlyAccessStore } from './signup';

/** Database refused the call: PostgREST code + short message for logs and alerts. */
export class StoreError extends Error {
  /** PostgREST's short message (never `details`, which can echo row values). */
  constructor(public readonly code: string, public readonly reason = '') {
    super(`store_error:${code}`);
  }
}

const TABLE = 'waitlist_signups';

/**
 * waitlist_signups through the service role: since 20261028000002 nobody else can write it.
 * Untyped client on purpose: the new columns land before database.types.ts is regenerated.
 */
export const createSupabaseStore = (client?: SupabaseClient): EarlyAccessStore => {
  const db = client ?? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const fail = (error: { code?: string; message?: string } | null): never => {
    throw new StoreError(error?.code || 'unknown', (error?.message ?? '').slice(0, 120));
  };

  return {
    async findByEmail(email) {
      const { data, error } = await db.from(TABLE).select('id, unsubscribed_at').eq('email', email).maybeSingle();
      if (error) fail(error);
      return (data as { id: string; unsubscribed_at: string | null } | null) ?? null;
    },
    async insert(row) {
      const { data, error } = await db.from(TABLE).insert(row).select('id').single();
      if (error?.code === '23505') return 'duplicate';
      if (error) fail(error);
      return { id: (data as { id: string }).id };
    },
    async resubscribe(id, consent) {
      const { error } = await db.from(TABLE).update({ ...consent, unsubscribed_at: null }).eq('id', id);
      if (error) fail(error);
    },
    async markWelcomeSent(id, at) {
      const { error } = await db.from(TABLE).update({ welcome_sent_at: at }).eq('id', id);
      if (error) fail(error);
    },
    async unsubscribe(id, at) {
      const { data, error } = await db
        .from(TABLE)
        .update({ unsubscribed_at: at })
        .eq('id', id)
        .is('unsubscribed_at', null)
        .select('id');
      if (error) fail(error);
      return Array.isArray(data) && data.length > 0;
    },
    async countSince(iso) {
      const { count, error } = await db.from(TABLE).select('id', { count: 'exact', head: true }).gte('created_at', iso);
      if (error) fail(error);
      return count ?? 0;
    },
  };
};
