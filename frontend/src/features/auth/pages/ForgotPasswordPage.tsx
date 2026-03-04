import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { resetPassword, loading, error, clearError } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      await resetPassword(email)
      setSent(true)
    } catch (err) {
      // Error already set in store
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary-500/10 via-dark-800 to-dark-800 pointer-events-none" />
        <div className="relative glass rounded-2xl p-8 max-w-md w-full">
          <div className="glass rounded-xl border-green-500/30 p-4 mb-6">
            <h3 className="text-sm font-medium text-green-400">
              Password reset email sent
            </h3>
            <p className="mt-2 text-sm text-green-400/80">
              Check your email for a link to reset your password. If it doesn't appear within a few minutes, check your spam folder.
            </p>
          </div>
          <div className="text-center">
            <Link to="/login" className="text-sm font-medium text-accent-500 hover:text-accent-400 transition-colors">
              Return to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-b from-primary-500/10 via-dark-800 to-dark-800 pointer-events-none" />
      <div className="relative glass rounded-2xl p-8 max-w-md w-full">
        <h2 className="text-3xl font-bold text-white text-center mb-2">
          Reset your password
        </h2>
        <p className="text-center text-sm text-gray-400 mb-8">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full h-11 px-3 rounded-xl bg-dark-600 border border-white/10 text-white
                         placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="glass rounded-xl border-red-500/30 p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white font-semibold
                       hover:shadow-glow transition-all duration-200
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm font-medium text-accent-500 hover:text-accent-400 transition-colors">
            Return to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
