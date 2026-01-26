import { useState } from "react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { useProfile } from "../hooks/useProfile";
import { useShippingAddresses } from "../hooks/useShippingAddresses";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileEditForm } from "../components/ProfileEditForm";
import { PhotoUploadButton } from "../components/PhotoUploadButton";
import { SellerStats } from "../components/SellerStats";
import { ShippingAddressList } from "../components/ShippingAddressList";
import { ShippingAddressForm } from "../components/ShippingAddressForm";
import { LogoutButton } from "@/features/auth/components/LogoutButton";
import type { Database } from "@/types/database.types";

type ShippingAddress =
  Database["public"]["Tables"]["shipping_addresses"]["Row"];

export function ProfilePage() {
  const { user } = useAuth();
  const {
    profile,
    loading: profileLoading,
    error: profileError,
    refetch,
  } = useProfile(user?.id);
  const {
    addresses,
    loading: addressesLoading,
    error: addressesError,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
  } = useShippingAddresses();

  const [editingProfile, setEditingProfile] = useState(false);
  const [editingAddress, setEditingAddress] = useState<ShippingAddress | null>(
    null,
  );
  const [showAddressForm, setShowAddressForm] = useState(false);

  if (profileLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <main role="main">
          <div className="text-center" role="status" aria-live="polite">Loading profile...</div>
        </main>
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <main role="main">
          <div className="rounded-md bg-red-50 p-4" role="alert">
            <p className="text-sm text-red-800">
              {profileError?.message || "Failed to load profile"}
            </p>
          </div>
        </main>
      </div>
    );
  }

  const handleProfileEditSuccess = () => {
    setEditingProfile(false);
    refetch();
  };

  const handlePhotoUploadComplete = () => {
    refetch();
  };

  const handleAddressSubmit = async (data: any) => {
    if (editingAddress) {
      await updateAddress(editingAddress.id, data);
    } else {
      await createAddress(data);
    }
    setShowAddressForm(false);
    setEditingAddress(null);
  };

  const handleAddAddressClick = () => {
    setEditingProfile(false);
    setShowAddressForm(true);
  };

  const handleEditAddressClick = (address: ShippingAddress) => {
    setEditingProfile(false);
    setEditingAddress(address);
  };

  const handleCancelAddressForm = () => {
    setShowAddressForm(false);
    setEditingAddress(null);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <main role="main">
        {/* Page Header with Logout */}
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <LogoutButton variant="secondary" />
        </header>

        <div className="space-y-6">
          {/* Profile Header */}
          {!editingProfile ? (
            <>
              <section aria-labelledby="profile-heading">
                <h2 id="profile-heading" className="sr-only">Profile Information</h2>
                <ProfileHeader
                  profile={profile}
                  isOwnProfile={true}
                  onEditClick={() => setEditingProfile(true)}
                />
              </section>
              <section aria-labelledby="photo-heading" className="bg-white rounded-lg shadow p-6">
                <h2 id="photo-heading" className="text-lg font-semibold mb-4">Profile Photo</h2>
                <PhotoUploadButton
                  userId={profile.id}
                  onUploadComplete={handlePhotoUploadComplete}
                />
              </section>
            </>
          ) : (
            <section aria-labelledby="edit-profile-heading" className="bg-white rounded-lg shadow p-6">
              <h2 id="edit-profile-heading" className="text-xl font-bold mb-4">Edit Profile</h2>
              <ProfileEditForm
                profile={profile}
                onSuccess={handleProfileEditSuccess}
                onCancel={() => setEditingProfile(false)}
              />
            </section>
          )}

          {/* Seller Stats */}
          <section aria-labelledby="stats-heading">
            <h2 id="stats-heading" className="sr-only">Seller Statistics</h2>
            <SellerStats profile={profile} />
          </section>

          {/* Shipping Addresses */}
          <section aria-labelledby="addresses-heading" className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 id="addresses-heading" className="text-lg font-semibold">Shipping Addresses</h2>
              {!showAddressForm && !editingAddress && (
                <button
                  onClick={handleAddAddressClick}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
                  aria-label="Add new shipping address"
                >
                  Add Address
                </button>
              )}
            </div>

            {addressesError && (
              <div className="rounded-md bg-red-50 p-4 mb-4" role="alert">
                <p className="text-sm text-red-800">{addressesError.message}</p>
              </div>
            )}

            {showAddressForm || editingAddress ? (
              <ShippingAddressForm
                address={editingAddress}
                onSubmit={handleAddressSubmit}
                onCancel={handleCancelAddressForm}
                loading={addressesLoading}
              />
            ) : (
              <ShippingAddressList
                addresses={addresses}
                onEdit={handleEditAddressClick}
                onDelete={deleteAddress}
                onSetDefault={setDefaultAddress}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
