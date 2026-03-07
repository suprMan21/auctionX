import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database.types'

type ShippingAddress = Database['public']['Tables']['shipping_addresses']['Row']
type ShippingAddressInsert = Database['public']['Tables']['shipping_addresses']['Insert']
type ShippingAddressUpdate = Database['public']['Tables']['shipping_addresses']['Update']

export interface UseShippingAddressesResult {
  addresses: ShippingAddress[]
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  createAddress: (address: Omit<ShippingAddressInsert, 'user_id'>) => Promise<ShippingAddress>
  updateAddress: (id: string, updates: Omit<ShippingAddressUpdate, 'id' | 'user_id'>) => Promise<void>
  deleteAddress: (id: string) => Promise<void>
  setDefaultAddress: (id: string) => Promise<void>
}

export function useShippingAddresses(): UseShippingAddressesResult {
  const [addresses, setAddresses] = useState<ShippingAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchAddresses = async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('Not authenticated')
      }

      const { data, error: fetchError } = await supabase
        .from('shipping_addresses')
        .select('*')
        .eq('user_id', user.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })

      if (fetchError) {
        throw new Error(`Failed to fetch addresses: ${fetchError.message}`)
      }

      setAddresses(data || [])
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      console.error('[useShippingAddresses] Fetch error:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAddresses()
  }, [])

  const createAddress = async (address: Omit<ShippingAddressInsert, 'user_id'>): Promise<ShippingAddress> => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('Not authenticated')
      }

      const insertData: ShippingAddressInsert = {
        ...address,
        user_id: user.id,
      }

      const { data, error: insertError } = await supabase
        .from('shipping_addresses')
        .insert(insertData)
        .select()
        .single()

      if (insertError) {
        throw new Error(`Failed to create address: ${insertError.message}`)
      }

      if (!data) {
        throw new Error('No data returned after insert')
      }

      await fetchAddresses()
      return data
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      console.error('[useShippingAddresses] Create error:', error)
      throw error
    }
  }

  const updateAddress = async (id: string, updates: Omit<ShippingAddressUpdate, 'id' | 'user_id'>) => {
    try {
      const updateData: ShippingAddressUpdate = updates

      const { error: updateError } = await supabase
        .from('shipping_addresses')
        .update(updateData)
        .eq('id', id)

      if (updateError) {
        throw new Error(`Failed to update address: ${updateError.message}`)
      }

      await fetchAddresses()
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      console.error('[useShippingAddresses] Update error:', error)
      throw error
    }
  }

  const deleteAddress = async (id: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('shipping_addresses')
        .delete()
        .eq('id', id)

      if (deleteError) {
        throw new Error(`Failed to delete address: ${deleteError.message}`)
      }

      await fetchAddresses()
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      console.error('[useShippingAddresses] Delete error:', error)
      throw error
    }
  }

  const setDefaultAddress = async (id: string) => {
    try {
      const updateData: ShippingAddressUpdate = { is_default: true }

      const { error: updateError } = await supabase
        .from('shipping_addresses')
        .update(updateData)
        .eq('id', id)

      if (updateError) {
        throw new Error(`Failed to set default address: ${updateError.message}`)
      }

      await fetchAddresses()
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      console.error('[useShippingAddresses] Set default error:', error)
      throw error
    }
  }

  return {
    addresses,
    loading,
    error,
    refetch: fetchAddresses,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
  }
}
