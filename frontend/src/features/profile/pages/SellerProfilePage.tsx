import { useParams } from 'react-router-dom'
import { useProfile } from '../hooks/useProfile'
import { SellerProfileCard } from '../components/SellerProfileCard'
import { SellerStats } from '../components/SellerStats'

export function SellerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { profile, loading, error } = useProfile(id)

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center">Loading seller profile...</div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">
            {error?.message || 'Seller not found'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="space-y-6">
        <SellerProfileCard profile={profile} />
        <SellerStats profile={profile} />
      </div>
    </div>
  )
}
