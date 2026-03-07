import { useEffect } from "react";
import { useAuthStore } from "../store/authStore";

export const useAuth = () => {
  const {
    user,
    session,
    loading,
    initialized,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    checkProfileComplete,
    clearError,
    initialize,
  } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []);

  return {
    user,
    session,
    loading,
    initialized,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    checkProfileComplete,
    clearError,
    isAuthenticated: !!user,
  };
};
