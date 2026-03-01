import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function createSupabaseClient(authHeader?: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  
  if (authHeader) {
    return createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader }
      }
    });
  }
  
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, serviceRoleKey);
}
