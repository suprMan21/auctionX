import type { Database } from "@/types/database.types";
import { useState } from "react";

type ShippingAddress =
  Database["public"]["Tables"]["shipping_addresses"]["Row"];

interface ShippingAddressListProps {
  addresses: ShippingAddress[];
  onEdit: (address: ShippingAddress) => void;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
}

export function ShippingAddressList({
  addresses,
  onEdit,
  onDelete,
  onSetDefault,
}: ShippingAddressListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (id: string, isDefault: boolean) => {
    setError(null);

    // Prevent deleting default address
    if (isDefault) {
      setError(
        "Cannot delete your default address. Please set another address as default first.",
      );
      return;
    }

    if (!confirm("Are you sure you want to delete this address?")) return;

    try {
      setDeletingId(id);
      await onDelete(id);
    } catch (err) {
      console.error("[ShippingAddressList] Delete error:", err);
      setError(err instanceof Error ? err.message : "Failed to delete address");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      setError(null);
      setSettingDefaultId(id);
      await onSetDefault(id);
    } catch (err) {
      console.error("[ShippingAddressList] Set default error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to set default address",
      );
    } finally {
      setSettingDefaultId(null);
    }
  };

  if (addresses.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No shipping addresses yet.</p>
        <p className="text-sm mt-1">Add one to get started!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error message - announced to screen readers */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="glass rounded-xl p-4 border border-red-500/20"
        >
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {addresses.map((address) => (
        <div
          key={address.id}
          className={`glass rounded-2xl p-4 ${
            address.is_default ? "border-primary-500 border-2" : "border-white/10"
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold text-white">{address.name}</h4>
                {address.is_default && (
                  <span
                    className="px-2 py-0.5 bg-primary-500/20 text-primary-400 text-xs font-medium rounded"
                    aria-label="Default shipping address"
                  >
                    Default
                  </span>
                )}
              </div>

              <address className="not-italic text-sm text-gray-300">
                <p>{address.address_line1}</p>
                {address.address_line2 && <p>{address.address_line2}</p>}
                <p>
                  {address.city}, {address.region} {address.postal_code}
                </p>
                <p>{address.country}</p>
                {address.phone_number && (
                  <p className="text-gray-400 mt-1">{address.phone_number}</p>
                )}
              </address>
            </div>

            <div className="flex flex-col gap-2 ml-4">
              {!address.is_default && (
                <button
                  onClick={() => handleSetDefault(address.id)}
                  disabled={settingDefaultId === address.id}
                  aria-label={`Set ${address.name} as default address`}
                  className="text-xs text-primary-400 hover:text-primary-300 font-medium disabled:opacity-50"
                >
                  {settingDefaultId === address.id
                    ? "Setting..."
                    : "Set as Default"}
                </button>
              )}
              <button
                onClick={() => onEdit(address)}
                aria-label={`Edit ${address.name} address`}
                className="text-xs text-gray-400 hover:text-gray-300 font-medium"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(address.id, address.is_default)}
                disabled={deletingId === address.id || address.is_default}
                aria-label={
                  address.is_default
                    ? `Cannot delete default address ${address.name}`
                    : `Delete ${address.name} address`
                }
                className={`text-xs font-medium disabled:opacity-50 ${
                  address.is_default
                    ? "text-gray-500 cursor-not-allowed"
                    : "text-red-400 hover:text-red-300"
                }`}
                title={
                  address.is_default ? "Cannot delete default address" : ""
                }
              >
                {deletingId === address.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
