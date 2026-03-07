import { create } from "zustand";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  checkProfileComplete: (userId: string) => Promise<boolean>;
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  clearError: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: false,
  initialized: false,
  error: null,

  initialize: async () => {
    if (get().initialized) return;
    console.log('[auth] initialize called');

    try {
      // First try getSession() which returns the in-memory cached session
      let { data: { session } } = await supabase.auth.getSession();
      console.log('[auth] getSession result:', !!session);

      // If no session but there's a token in localStorage, restore it.
      // This handles the race where getSession() resolves before the
      // Supabase client's internal async init reads from storage.
      if (!session) {
        const stored = localStorage.getItem(
          `sb-pmlofthmobglcfkqjtru-auth-token`
        );
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.access_token && parsed.refresh_token) {
            const { data, error } = await supabase.auth.setSession({
              access_token: parsed.access_token,
              refresh_token: parsed.refresh_token,
            });
            if (!error) session = data.session;
          }
        }
      }

      console.log('[auth] final session:', !!session, 'user:', session?.user?.email);
      set({
        user: session?.user ?? null,
        session,
        initialized: true,
      });
    } catch (error: any) {
      console.error('[auth] Failed to initialize:', error);
      set({ initialized: true });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      set({ user: data.user, session: data.session });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  signUp: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) throw error;
      set({ user: data.user, session: data.session });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      set({ user: null, session: null });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ loading: false });
    }
  },

  resetPassword: async (email: string) => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  checkProfileComplete: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", userId)
        .single();

      if (error) throw error;

      return !!data?.display_name;
    } catch (error) {
      console.error("Error checking profile:", error);
      return false;
    }
  },

  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  clearError: () => set({ error: null }),
}));

supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState({
    user: session?.user ?? null,
    session,
    initialized: true,
  });
});
