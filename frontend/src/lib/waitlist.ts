import { supabase } from './supabase';

export const joinWaitlist = async (email: string, source: string = 'collector') => {
  const { error } = await supabase
    .from('waitlist_signups')
    .insert({ email: email.trim().toLowerCase(), source });

  if (error) {
    if (error.code === '23505') {
      return { success: true, duplicate: true };
    }
    throw error;
  }
  return { success: true, duplicate: false };
};
