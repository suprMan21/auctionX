import type { Database } from '@/types/database.types'

type SellerTier = Database['public']['Enums']['tier_level']

interface SellerTierBadgeProps {
  tier: SellerTier
  className?: string
}

const tierConfig: Record<SellerTier, { label: string; dotColor: string; borderColor: string; textColor: string; useGradientText?: boolean }> = {
  TIER_1: {
    label: 'Bronze',
    dotColor: 'bg-orange-400',
    borderColor: 'border-orange-400/30',
    textColor: 'text-orange-300',
  },
  TIER_2: {
    label: 'Silver',
    dotColor: 'bg-gray-300',
    borderColor: 'border-gray-300/30',
    textColor: 'text-gray-300',
  },
  TIER_3: {
    label: 'Gold',
    dotColor: 'bg-primary-500 animate-pulse',
    borderColor: 'border-primary-500/30',
    textColor: '',
    useGradientText: true,
  },
}

export function SellerTierBadge({ tier, className = '' }: SellerTierBadgeProps) {
  const config = tierConfig[tier]

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium glass border ${config.borderColor} ${className}`}>
      <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
      <span className={config.useGradientText ? 'text-gradient' : config.textColor}>{config.label}</span>
    </span>
  )
}
