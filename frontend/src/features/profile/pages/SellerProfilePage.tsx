import { useParams, Link } from 'react-router-dom'
import { useProfile } from '../hooks/useProfile'
import { SellerProfileCard } from '../components/SellerProfileCard'
import { SellerStats } from '../components/SellerStats'

export function SellerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const { profile, loading, error } = useProfile(id)

  if (loading) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto px-4 py-8 bg-dark-800">
        <div className="text-center text-gray-400">Loading seller profile...</div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen max-w-4xl mx-auto px-4 py-8 bg-dark-800">
        <div className="glass rounded-2xl p-8 border border-red-500/20 text-center">
          <p className="text-sm text-red-400 mb-6">
            {error?.message || 'Seller not found'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/browse"
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              Back to Browse
            </Link>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white font-medium hover:opacity-90 shadow-glow transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              Try Again
            </button>
          </div>
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
