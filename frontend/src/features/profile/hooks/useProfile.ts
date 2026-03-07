import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database.types'

type User = Database['public']['Tables']['users']['Row']
type UserUpdate = Database['public']['Tables']['users']['Update']
type BrandType = Database['public']['Enums']['brand_type']

export interface UseProfileResult {
  profile: User | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useProfile(userId?: string): UseProfileResult {
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchProfile = async () => {
    try {
      setLoading(true)
      setError(null)

      if (!userId) {
        throw new Error('User ID is required')
      }

      console.log('[useProfile] Fetching profile for userId:', userId)

      const { data, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      console.log('[useProfile] Result:', { data, fetchError })

      if (fetchError) {
        throw new Error(`Failed to fetch profile: ${fetchError.message}`)
      }

      if (!data) {
        throw new Error('Profile not found')
      }

      setProfile(data)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      console.error('[useProfile] Error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (userId) {
      fetchProfile()
    } else {
      setLoading(false)
    }
  }, [userId])

  return {
    profile,
    loading,
    error,
    refetch: fetchProfile,
  }
}

export interface UpdateProfileData {
  display_name?: string
  phone_number?: string
  photo_url?: string
  preferred_brand?: BrandType
}

export interface UseUpdateProfileResult {
  updateProfile: (data: UpdateProfileData) => Promise<void>
  loading: boolean
  error: Error | null
}

export function useUpdateProfile(): UseUpdateProfileResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const updateProfile = async (data: UpdateProfileData) => {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('Not authenticated')
      }

      const updateData: UserUpdate = {
        ...data,
        updated_at: new Date().toISOString(),
      }

      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id)

      if (updateError) {
        throw new Error(`Failed to update profile: ${updateError.message}`)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      console.error('[useUpdateProfile] Error:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  return {
    updateProfile,
    loading,
    error,
  }
}
