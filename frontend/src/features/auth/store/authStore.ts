import { create } from 'zustand'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  error: null,
  
  signIn: async (email: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) throw error
      set({ user: data.user, session: data.session })
    } catch (error: any) {
      set({ error: error.message })
      throw error
    } finally {
      set({ loading: false })
    }
  },
  
  signUp: async (email: string, password: string) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      })
      if (error) throw error
      set({ user: data.user, session: data.session })
    } catch (error: any) {
      set({ error: error.message })
      throw error
    } finally {
      set({ loading: false })
    }
  },
  
  signOut: async () => {
    set({ loading: true, error: null })
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      set({ user: null, session: null })
    } catch (error: any) {
      set({ error: error.message })
    } finally {
      set({ loading: false })
    }
  },
  
  resetPassword: async (email: string) => {
    set({ loading: true, error: null })
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      })
      if (error) throw error
    } catch (error: any) {
      set({ error: error.message })
      throw error
    } finally {
      set({ loading: false })
    }
  },
  
  setUser: (user) => set({ user, loading: false }),
  setSession: (session) => set({ session, loading: false }),
  clearError: () => set({ error: null })
}))
