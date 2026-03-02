import type { Database } from '@/types/database.types'

type SellerTier = Database['public']['Enums']['tier_level']

interface SellerTierBadgeProps {
  tier: SellerTier
  className?: string
}

const tierConfig: Record<SellerTier, { label: string; color: string; icon: string }> = {
  TIER_1: {
    label: 'Bronze',
    color: 'bg-amber-700 text-white',
    icon: '🥉',
  },
  TIER_2: {
    label: 'Silver',
    color: 'bg-gray-400 text-white',
    icon: '🥈',
  },
  TIER_3: {
    label: 'Gold',
    color: 'bg-yellow-400 text-gray-900',
    icon: '🥇',
  },
}

export function SellerTierBadge({ tier, className = '' }: SellerTierBadgeProps) {
  const config = tierConfig[tier]

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${config.color} ${className}`}>
      <span>{config.icon}</span>
      <span>{config.label}</span>
    </span>
  )
}
