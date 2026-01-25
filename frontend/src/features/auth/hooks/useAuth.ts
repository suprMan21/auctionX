import { useAuthStore } from '../store/authStore'

export const useAuth = () => {
  const {
    user,
    session,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    clearError
  } = useAuthStore()

  return {
    user,
    session,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    clearError,
    isAuthenticated: !!user
  }
}
