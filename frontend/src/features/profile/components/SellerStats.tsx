import type { Database } from '@/types/database.types'
import { SellerTierBadge } from '@/components/ui/SellerTierBadge'

type User = Database['public']['Tables']['users']['Row']

interface SellerStatsProps {
  profile: User
}

export function SellerStats({ profile }: SellerStatsProps) {
  const lifetimeSales = (profile.lifetime_sales_cents / 100).toFixed(2)
  const trailing12moSales = (profile.trailing_12mo_sales_cents / 100).toFixed(2)
  
  const currentSales = profile.trailing_12mo_sales_cents
  const nextTierThreshold = profile.seller_tier === 'TIER_1' ? 1000000 : 10000000
  const progress = Math.min((currentSales / nextTierThreshold) * 100, 100)
  const nextTierName = profile.seller_tier === 'TIER_1' ? 'Silver' : 'Gold'

  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Seller Stats</h3>

      <div className="space-y-4">
        <div>
          <label className="text-sm text-gray-400">Current Tier</label>
          <div className="mt-1">
            <SellerTierBadge tier={profile.seller_tier} />
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-400">Lifetime Sales</label>
          <p className="text-2xl font-bold text-white">${lifetimeSales} CAD</p>
        </div>

        <div>
          <label className="text-sm text-gray-400">Last 12 Months</label>
          <p className="text-xl font-semibold text-gray-200">${trailing12moSales} CAD</p>
        </div>

        {profile.seller_tier !== 'TIER_3' && (
          <div>
            <label className="text-sm text-gray-400">Progress to Next Tier</label>
            <div className="mt-2">
              <div className="w-full bg-dark-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-primary-500 to-accent-500 h-2 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {progress.toFixed(1)}% to {nextTierName}
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="text-sm text-gray-400">Verification Status</label>
          <p className="mt-1">
            {profile.seller_verification_status === 'APPROVED' && (
              <span className="text-green-400 font-medium">✓ Verified Seller</span>
            )}
            {profile.seller_verification_status === 'PENDING' && (
              <span className="text-yellow-400 font-medium">⏳ Pending Review</span>
            )}
            {profile.seller_verification_status === 'NONE' && (
              <span className="text-gray-400">Not verified</span>
            )}
            {profile.seller_verification_status === 'REJECTED' && (
              <span className="text-red-400 font-medium">✗ Verification rejected</span>
            )}
          </p>
          {profile.seller_verification_status === 'REJECTED' && profile.seller_verification_rejection_reason && (
            <p className="text-xs text-red-400 mt-1">{profile.seller_verification_rejection_reason}</p>
          )}
        </div>

        {profile.age_verified && (
          <div>
            <span className="text-green-400 text-sm">✓ Age verified</span>
          </div>
        )}
      </div>
    </div>
  )
}
