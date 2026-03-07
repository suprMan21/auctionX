import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "@/lib/supabase";

export const LoginForm = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signIn, checkProfileComplete, loading, error, clearError } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await signIn(email, password);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        const isProfileComplete = await checkProfileComplete(session.user.id);

        if (isProfileComplete) {
          navigate("/my-listings");
        } else {
          navigate("/profile");
        }
      } else {
        navigate("/my-listings");
      }
    } catch (err) {
      console.error("Login error:", err);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-300"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-1 block w-full rounded-xl bg-dark-700 border border-white/10 text-white px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-gray-300"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="mt-1 block w-full rounded-xl bg-dark-700 border border-white/10 text-white px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex justify-center py-2 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-accent-500 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 focus:ring-offset-dark-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
};
