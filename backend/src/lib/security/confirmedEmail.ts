import type { User } from '@supabase/supabase-js';

/**
 * The caller's email as Supabase Auth has confirmed it, lowercased; null when
 * there is none. Use this, never `public.users.email`, for any check that
 * decides who someone is: that column is a profile copy, not proof.
 */
export const confirmedEmail = (user: Pick<User, 'email' | 'email_confirmed_at'>): string | null =>
  user.email && user.email_confirmed_at ? user.email.trim().toLowerCase() : null;
