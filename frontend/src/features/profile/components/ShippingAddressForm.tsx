import { useState } from "react";
import type { Database } from "@/types/database.types";

type ShippingAddress =
  Database["public"]["Tables"]["shipping_addresses"]["Row"];
type ShippingAddressInsert =
  Database["public"]["Tables"]["shipping_addresses"]["Insert"];

interface ShippingAddressFormProps {
  address?: ShippingAddress | null;
  onSubmit: (data: Omit<ShippingAddressInsert, "user_id">) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "JP", name: "Japan" },
];

export function ShippingAddressForm({
  address,
  onSubmit,
  onCancel,
  loading = false,
}: ShippingAddressFormProps) {
  const [formData, setFormData] = useState({
    name: address?.name || "",
    address_line1: address?.address_line1 || "",
    address_line2: address?.address_line2 || "",
    city: address?.city || "",
    region: address?.region || "",
    postal_code: address?.postal_code || "",
    country: address?.country || "US",
    phone_number: address?.phone_number || "",
    is_default: address?.is_default || false,
  });

  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        type === "checkbox" ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    // Validation
    if (!formData.name.trim()) {
      setValidationError("Name is required");
      return;
    }
    if (!formData.address_line1.trim()) {
      setValidationError("Address line 1 is required");
      return;
    }
    if (!formData.city.trim()) {
      setValidationError("City is required");
      return;
    }
    if (!formData.region.trim()) {
      setValidationError("State/Province is required");
      return;
    }
    if (!formData.postal_code.trim()) {
      setValidationError("Postal code is required");
      return;
    }

    try {
      await onSubmit({
        ...formData,
        address_line2: formData.address_line2 || null,
        phone_number: formData.phone_number || null,
      });
      setSuccessMessage(
        address ? "Address updated successfully" : "Address added successfully",
      );
    } catch (err) {
      console.error("[ShippingAddressForm] Submit error:", err);
      setValidationError(
        err instanceof Error ? err.message : "Failed to save address",
      );
    }
  };

  const formTitle = address ? "Edit Shipping Address" : "Add Shipping Address";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={formTitle}>
      {/* Success message - announced to screen readers */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md bg-green-50 p-4"
        >
          <p className="text-sm text-green-800">{successMessage}</p>
        </div>
      )}

      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-gray-700"
        >
          Full Name *
        </label>
        <input
          id="name"
          name="name"
          type="text"
          value={formData.name}
          onChange={handleChange}
          required
          aria-required="true"
          aria-invalid={!!validationError}
          aria-errormessage={validationError ? "address-form-error" : undefined}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="address_line1"
          className="block text-sm font-medium text-gray-700"
        >
          Address Line 1 *
        </label>
        <input
          id="address_line1"
          name="address_line1"
          type="text"
          value={formData.address_line1}
          onChange={handleChange}
          required
          aria-required="true"
          aria-invalid={!!validationError}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="address_line2"
          className="block text-sm font-medium text-gray-700"
        >
          Address Line 2
        </label>
        <input
          id="address_line2"
          name="address_line2"
          type="text"
          value={formData.address_line2}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="city"
            className="block text-sm font-medium text-gray-700"
          >
            City *
          </label>
          <input
            id="city"
            name="city"
            type="text"
            value={formData.city}
            onChange={handleChange}
            required
            aria-required="true"
            aria-invalid={!!validationError}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="region"
            className="block text-sm font-medium text-gray-700"
          >
            State/Province *
          </label>
          <input
            id="region"
            name="region"
            type="text"
            value={formData.region}
            onChange={handleChange}
            required
            aria-required="true"
            aria-invalid={!!validationError}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="postal_code"
            className="block text-sm font-medium text-gray-700"
          >
            Postal Code *
          </label>
          <input
            id="postal_code"
            name="postal_code"
            type="text"
            value={formData.postal_code}
            onChange={handleChange}
            required
            aria-required="true"
            aria-invalid={!!validationError}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="country"
            className="block text-sm font-medium text-gray-700"
          >
            Country *
          </label>
          <select
            id="country"
            name="country"
            value={formData.country}
            onChange={handleChange}
            required
            aria-required="true"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label
          htmlFor="phone_number"
          className="block text-sm font-medium text-gray-700"
        >
          Phone Number
        </label>
        <input
          id="phone_number"
          name="phone_number"
          type="tel"
          value={formData.phone_number}
          onChange={handleChange}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex items-center">
        <input
          id="is_default"
          name="is_default"
          type="checkbox"
          checked={formData.is_default}
          onChange={handleChange}
          aria-describedby="is_default-description"
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label
          htmlFor="is_default"
          className="ml-2 block text-sm text-gray-700"
        >
          Set as default address
        </label>
        <span id="is_default-description" className="sr-only">
          Make this your default shipping address for future orders
        </span>
      </div>

      {/* Error message - announced to screen readers */}
      {validationError && (
        <div
          id="address-form-error"
          role="alert"
          aria-live="assertive"
          className="rounded-md bg-red-50 p-4"
        >
          <p className="text-sm text-red-800">{validationError}</p>
        </div>
      )}

      <div className="flex gap-3 justify-end pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          aria-label="Cancel address form"
          className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          aria-label={
            loading
              ? "Saving address"
              : address
                ? "Update address"
                : "Add address"
          }
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : address ? "Update Address" : "Add Address"}
        </button>
      </div>
    </form>
  );
}
