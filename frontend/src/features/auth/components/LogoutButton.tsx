import { useAuth } from '@/features/auth/hooks/useAuth'
import { useNavigate } from 'react-router-dom'

interface LogoutButtonProps {
  className?: string
  variant?: 'primary' | 'secondary' | 'text'
}

export function LogoutButton({ className, variant = 'secondary' }: LogoutButtonProps) {
  const { signOut, loading } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const baseStyles = 'px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800'

  const variantStyles = {
    primary: 'bg-red-600 text-white hover:bg-red-500',
    secondary: 'border border-white/10 text-gray-300 hover:bg-white/5',
    text: 'text-gray-400 hover:text-white hover:underline px-2'
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      aria-label="Log out of your account"
      className={`${baseStyles} ${variantStyles[variant]} ${className || ''}`}
    >
      {loading ? 'Logging out...' : 'Log Out'}
    </button>
  )
}
