import type { Database } from '@/types/database.types'
import { SellerTierBadge } from '@/components/ui/SellerTierBadge'

type User = Database['public']['Tables']['users']['Row']

interface SellerProfileCardProps {
  profile: User
}

export function SellerProfileCard({ profile }: SellerProfileCardProps) {
  const displayName = profile.display_name || 'Anonymous Seller'
  const initials = displayName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          {profile.photo_url ? (
            <img
              src={profile.photo_url}
              alt={displayName}
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-300 flex items-center justify-center text-xl font-bold text-gray-600">
              {initials}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-gray-900 truncate">{displayName}</h2>
          
          <div className="mt-2 flex items-center gap-2">
            <SellerTierBadge tier={profile.seller_tier} />
            {profile.seller_verification_status === 'APPROVED' && (
              <span className="text-green-600 text-sm font-medium">✓ Verified</span>
            )}
          </div>

          <div className="mt-3 text-sm text-gray-600">
            <p>Member since {new Date(profile.created_at).getFullYear()}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
