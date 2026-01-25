import type { Database } from '@/types/database.types'
import { useState } from 'react'

type ShippingAddress = Database['public']['Tables']['shipping_addresses']['Row']

interface ShippingAddressListProps {
  addresses: ShippingAddress[]
  onEdit: (address: ShippingAddress) => void
  onDelete: (id: string) => Promise<void>
  onSetDefault: (id: string) => Promise<void>
}

export function ShippingAddressList({ 
  addresses, 
  onEdit, 
  onDelete, 
  onSetDefault 
}: ShippingAddressListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this address?')) return
    
    try {
      setDeletingId(id)
      await onDelete(id)
    } catch (err) {
      console.error('[ShippingAddressList] Delete error:', err)
    } finally {
      setDeletingId(null)
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      setSettingDefaultId(id)
      await onSetDefault(id)
    } catch (err) {
      console.error('[ShippingAddressList] Set default error:', err)
    } finally {
      setSettingDefaultId(null)
    }
  }

  if (addresses.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No shipping addresses yet.</p>
        <p className="text-sm mt-1">Add one to get started!</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {addresses.map((address) => (
        <div
          key={address.id}
          className={`bg-white border rounded-lg p-4 ${
            address.is_default ? 'border-blue-500 border-2' : 'border-gray-200'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold text-gray-900">{address.name}</h4>
                {address.is_default && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                    Default
                  </span>
                )}
              </div>
              
              <p className="text-sm text-gray-700">{address.address_line1}</p>
              {address.address_line2 && (
                <p className="text-sm text-gray-700">{address.address_line2}</p>
              )}
              <p className="text-sm text-gray-700">
                {address.city}, {address.region} {address.postal_code}
              </p>
              <p className="text-sm text-gray-700">{address.country}</p>
              {address.phone_number && (
                <p className="text-sm text-gray-600 mt-1">{address.phone_number}</p>
              )}
            </div>

            <div className="flex flex-col gap-2 ml-4">
              {!address.is_default && (
                <button
                  onClick={() => handleSetDefault(address.id)}
                  disabled={settingDefaultId === address.id}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {settingDefaultId === address.id ? 'Setting...' : 'Set as Default'}
                </button>
              )}
              <button
                onClick={() => onEdit(address)}
                className="text-xs text-gray-600 hover:text-gray-700 font-medium"
              >
                Edit
              </button>
              <button
                onClick={() => handleDelete(address.id)}
                disabled={deletingId === address.id}
                className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
              >
                {deletingId === address.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
