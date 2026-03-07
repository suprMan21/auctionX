import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListingCreation } from '../../../stores/listingCreationStore';

export function ReviewStep() {
  const navigate = useNavigate();
  const { draft, publishListing, setCurrentStep } = useListingCreation();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);

    try {
      const listingId = await publishListing();
      navigate(`/listings/${listingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPublishing(false);
    }
  };

  const canPublish =
    draft.title.trim() !== '' &&
    draft.category_id !== null &&
    draft.condition !== null &&
    draft.media.length > 0 &&
    draft.region !== '' &&
    draft.city !== '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-white mb-2">Review Your Listing</h2>
        <p className="text-sm text-gray-400">
          Review all information before publishing. You can edit any section by clicking on it.
        </p>
      </div>

      <div className="space-y-4">
        <div
          className="glass rounded-2xl p-4 cursor-pointer hover:border-white/20 hover:shadow-glow transition-colors"
          onClick={() => setCurrentStep(0)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Basic Information</h3>
              <p className="text-sm text-gray-400">{draft.title}</p>
              <p className="text-xs text-gray-400 mt-1">Condition: {draft.condition}</p>
            </div>
            <button className="text-primary-400 text-sm hover:text-primary-300">Edit</button>
          </div>
        </div>

        <div
          className="glass rounded-2xl p-4 cursor-pointer hover:border-white/20 hover:shadow-glow transition-colors"
          onClick={() => setCurrentStep(1)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Category</h3>
              <p className="text-sm text-gray-400">
                {draft.category_id ? `Category ID: ${draft.category_id}` : 'Not selected'}
              </p>
            </div>
            <button className="text-primary-400 text-sm hover:text-primary-300">Edit</button>
          </div>
        </div>

        <div
          className="glass rounded-2xl p-4 cursor-pointer hover:border-white/20 hover:shadow-glow transition-colors"
          onClick={() => setCurrentStep(2)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Media</h3>
              <p className="text-sm text-gray-400">{draft.media.length} items uploaded</p>
              {draft.media.length > 0 && (
                <div className="mt-2 flex space-x-2">
                  {draft.media.slice(0, 4).map((media, idx) => (
                    <img
                      key={idx}
                      src={media.url}
                      alt={`Preview ${idx + 1}`}
                      className="w-16 h-16 object-cover rounded-lg"
                    />
                  ))}
                  {draft.media.length > 4 && (
                    <div className="w-16 h-16 bg-dark-600 rounded-xl flex items-center justify-center text-xs text-gray-400">
                      +{draft.media.length - 4}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="text-primary-400 text-sm hover:text-primary-300">Edit</button>
          </div>
        </div>

        <div
          className="glass rounded-2xl p-4 cursor-pointer hover:border-white/20 hover:shadow-glow transition-colors"
          onClick={() => setCurrentStep(3)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Pricing</h3>
              <p className="text-sm text-gray-400">
                Reserve: ${(draft.reserve_price_cents / 100).toFixed(2)} {draft.currency}
              </p>
            </div>
            <button className="text-primary-400 text-sm hover:text-primary-300">Edit</button>
          </div>
        </div>

        <div
          className="glass rounded-2xl p-4 cursor-pointer hover:border-white/20 hover:shadow-glow transition-colors"
          onClick={() => setCurrentStep(4)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-white mb-1">Location</h3>
              <p className="text-sm text-gray-400">
                {draft.city}, {draft.region}, {draft.country}
                {draft.postal_fsa && ` (${draft.postal_fsa})`}
              </p>
            </div>
            <button className="text-primary-400 text-sm hover:text-primary-300">Edit</button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-error-500/10 border border-error-500/30 rounded-xl p-4">
          <p className="text-sm text-error-400">{error}</p>
        </div>
      )}

      <div className="border-t border-white/10 pt-4">
        <button
          onClick={handlePublish}
          disabled={!canPublish || publishing}
          className="w-full px-4 py-3 text-base font-medium text-white bg-gradient-primary rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {publishing ? 'Publishing...' : 'Publish Listing'}
        </button>
        {!canPublish && (
          <p className="mt-2 text-sm text-error-400 text-center">
            Please complete all required fields before publishing
          </p>
        )}
      </div>
    </div>
  );
}
