import { useState } from "react";
import { useUpdateProfile } from "../hooks/useProfile";
import type { Database } from "@/types/database.types";
import { BRAND_LABEL } from "@/constants/branding";

type User = Database["public"]["Tables"]["users"]["Row"];
type BrandType = Database["public"]["Enums"]["brand_type"];

interface ProfileEditFormProps {
  profile: User;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ProfileEditForm({
  profile,
  onSuccess,
  onCancel,
}: ProfileEditFormProps) {
  const { updateProfile, loading, error } = useUpdateProfile();
  const [displayName, setDisplayName] = useState(profile.display_name || "");
  const [phoneNumber, setPhoneNumber] = useState(profile.phone_number || "");
  const [preferredBrand, setPreferredBrand] = useState<BrandType>(
    profile.preferred_brand || "AUCTIONX",
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    if (displayName.length === 0) {
      setValidationError("Display name is required");
      return;
    }

    if (displayName.length > 120) {
      setValidationError("Display name must be 120 characters or less");
      return;
    }

    try {
      await updateProfile({
        display_name: displayName,
        phone_number: phoneNumber || undefined,
        preferred_brand: preferredBrand,
      });
      setSuccessMessage("Profile updated successfully");
      setTimeout(() => {
        onSuccess?.();
      }, 1000);
    } catch (err) {
      console.error("[ProfileEditForm] Submit error:", err);
    }
  };

  const currentError = validationError || error?.message;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Success message - announced to screen readers */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="glass rounded-xl p-4 border border-green-500/20"
        >
          <p className="text-sm text-green-400">{successMessage}</p>
        </div>
      )}

      <div>
        <label
          htmlFor="displayName"
          className="block text-sm font-medium text-gray-300"
        >
          Display Name *
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={120}
          required
          aria-describedby="displayName-hint"
          aria-invalid={!!currentError}
          aria-errormessage={currentError ? "form-error" : undefined}
          className="mt-1 block w-full rounded-xl bg-dark-700 border border-white/10 text-white px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <p id="displayName-hint" className="text-xs text-gray-400 mt-1">
          {displayName.length}/120 characters
        </p>
      </div>

      <div>
        <label
          htmlFor="phoneNumber"
          className="block text-sm font-medium text-gray-300"
        >
          Phone Number
        </label>
        <input
          id="phoneNumber"
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          aria-invalid={!!currentError}
          className="mt-1 block w-full rounded-xl bg-dark-700 border border-white/10 text-white px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <div>
        <label
          htmlFor="preferredBrand"
          className="block text-sm font-medium text-gray-300"
        >
          Preferred Brand
        </label>
        <select
          id="preferredBrand"
          value={preferredBrand}
          onChange={(e) => setPreferredBrand(e.target.value as BrandType)}
          className="mt-1 block w-full rounded-xl bg-dark-700 border border-white/10 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="AUCTIONX">{BRAND_LABEL.AUCTIONX}</option>
          <option value="UNMENTIONABLES">{BRAND_LABEL.UNMENTIONABLES}</option>
        </select>
      </div>

      {/* Error message - announced to screen readers */}
      {currentError && (
        <div
          id="form-error"
          role="alert"
          aria-live="assertive"
          className="glass rounded-xl p-4 border border-red-500/20"
        >
          <p className="text-sm text-red-400">{currentError}</p>
        </div>
      )}

      <div className="flex gap-3 justify-end pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="Cancel editing profile"
            className="px-4 py-2 rounded-xl border border-white/10 text-sm font-medium text-gray-400 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={loading}
          aria-label={
            loading ? "Saving profile changes" : "Save profile changes"
          }
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
