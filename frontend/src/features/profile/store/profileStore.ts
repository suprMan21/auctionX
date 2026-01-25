import { create } from 'zustand'
import type { Database } from '@/types/database.types'

type User = Database['public']['Tables']['users']['Row']
type ShippingAddress = Database['public']['Tables']['shipping_addresses']['Row']

interface ProfileState {
  currentProfile: User | null
  cachedProfiles: Map<string, User>
  shippingAddresses: ShippingAddress[]
  setCurrentProfile: (profile: User | null) => void
  cacheProfile: (userId: string, profile: User) => void
  getCachedProfile: (userId: string) => User | undefined
  setShippingAddresses: (addresses: ShippingAddress[]) => void
  clearCache: () => void
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  currentProfile: null,
  cachedProfiles: new Map(),
  shippingAddresses: [],

  setCurrentProfile: (profile) => {
    set({ currentProfile: profile })
    if (profile) {
      get().cacheProfile(profile.id, profile)
    }
  },

  cacheProfile: (userId, profile) => {
    set((state) => {
      const newCache = new Map(state.cachedProfiles)
      newCache.set(userId, profile)
      return { cachedProfiles: newCache }
    })
  },

  getCachedProfile: (userId) => {
    return get().cachedProfiles.get(userId)
  },

  setShippingAddresses: (addresses) => {
    set({ shippingAddresses: addresses })
  },

  clearCache: () => {
    set({
      currentProfile: null,
      cachedProfiles: new Map(),
      shippingAddresses: [],
    })
  },
}))
