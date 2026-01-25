import type { Database } from '@/types/database.types'

type User = Database['public']['Tables']['users']['Row']

interface ProfileHeaderProps {
  profile: User
  isOwnProfile?: boolean
  onEditClick?: () => void
}

export function ProfileHeader({ profile, isOwnProfile = false, onEditClick }: ProfileHeaderProps) {
  const displayName = profile.display_name || 'Anonymous User'
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
              className="w-24 h-24 rounded-full object-cover"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-300 flex items-center justify-center text-2xl font-bold text-gray-600">
              {initials}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{displayName}</h1>
          <p className="text-gray-600 mt-1">{profile.email}</p>
          {profile.phone_number && (
            <p className="text-gray-600 text-sm mt-1">{profile.phone_number}</p>
          )}
          {isOwnProfile && (
            <button
              onClick={onEditClick}
              className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Edit Profile
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
