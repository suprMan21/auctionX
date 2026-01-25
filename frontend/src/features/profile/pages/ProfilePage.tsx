import { useState } from 'react'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useProfile } from '../hooks/useProfile'
import { useShippingAddresses } from '../hooks/useShippingAddresses'
import { ProfileHeader } from '../components/ProfileHeader'
import { ProfileEditForm } from '../components/ProfileEditForm'
import { PhotoUploadButton } from '../components/PhotoUploadButton'
import { SellerStats } from '../components/SellerStats'
import { ShippingAddressList } from '../components/ShippingAddressList'
import { ShippingAddressForm } from '../components/ShippingAddressForm'
import type { Database } from '@/types/database.types'

type ShippingAddress = Database['public']['Tables']['shipping_addresses']['Row']

export function ProfilePage() {
  const { user } = useAuth()
  const { profile, loading: profileLoading, error: profileError, refetch } = useProfile(user?.id)
  const {
    addresses,
    loading: addressesLoading,
    error: addressesError,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
  } = useShippingAddresses()

  const [editingProfile, setEditingProfile] = useState(false)
  const [editingAddress, setEditingAddress] = useState<ShippingAddress | null>(null)
  const [showAddressForm, setShowAddressForm] = useState(false)

  if (profileLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center">Loading profile...</div>
      </div>
    )
  }

  if (profileError || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">
            {profileError?.message || 'Failed to load profile'}
          </p>
        </div>
      </div>
    )
  }

  const handleProfileEditSuccess = () => {
    setEditingProfile(false)
    refetch()
  }

  const handlePhotoUploadComplete = () => {
    refetch()
  }

  const handleAddressSubmit = async (data: any) => {
    if (editingAddress) {
      await updateAddress(editingAddress.id, data)
    } else {
      await createAddress(data)
    }
    setShowAddressForm(false)
    setEditingAddress(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="space-y-6">
        {/* Profile Header */}
        {!editingProfile ? (
          <>
            <ProfileHeader
              profile={profile}
              isOwnProfile={true}
              onEditClick={() => setEditingProfile(true)}
            />
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Profile Photo</h3>
              <PhotoUploadButton
                userId={profile.id}
                onUploadComplete={handlePhotoUploadComplete}
              />
            </div>
          </>
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Edit Profile</h2>
            <ProfileEditForm
              profile={profile}
              onSuccess={handleProfileEditSuccess}
              onCancel={() => setEditingProfile(false)}
            />
          </div>
        )}

        {/* Seller Stats */}
        <SellerStats profile={profile} />

        {/* Shipping Addresses */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Shipping Addresses</h3>
            {!showAddressForm && !editingAddress && (
              <button
                onClick={() => setShowAddressForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Add Address
              </button>
            )}
          </div>

          {addressesError && (
            <div className="rounded-md bg-red-50 p-4 mb-4">
              <p className="text-sm text-red-800">{addressesError.message}</p>
            </div>
          )}

          {(showAddressForm || editingAddress) ? (
            <ShippingAddressForm
              address={editingAddress}
              onSubmit={handleAddressSubmit}
              onCancel={() => {
                setShowAddressForm(false)
                setEditingAddress(null)
              }}
              loading={addressesLoading}
            />
          ) : (
            <ShippingAddressList
              addresses={addresses}
              onEdit={setEditingAddress}
              onDelete={deleteAddress}
              onSetDefault={setDefaultAddress}
            />
          )}
        </div>
      </div>
    </div>
  )
}
