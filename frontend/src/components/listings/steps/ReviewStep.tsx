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
        <h2 className="text-lg font-medium text-gray-900 mb-2">Review Your Listing</h2>
        <p className="text-sm text-gray-600">
          Review all information before publishing. You can edit any section by clicking on it.
        </p>
      </div>

      <div className="space-y-4">
        <div 
          className="border border-gray-200 rounded-md p-4 cursor-pointer hover:border-blue-500 transition-colors"
          onClick={() => setCurrentStep(0)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-1">Basic Information</h3>
              <p className="text-sm text-gray-600">{draft.title}</p>
              <p className="text-xs text-gray-500 mt-1">Condition: {draft.condition}</p>
            </div>
            <button className="text-blue-600 text-sm hover:text-blue-700">Edit</button>
          </div>
        </div>

        <div 
          className="border border-gray-200 rounded-md p-4 cursor-pointer hover:border-blue-500 transition-colors"
          onClick={() => setCurrentStep(1)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-1">Category</h3>
              <p className="text-sm text-gray-600">
                {draft.category_id ? `Category ID: ${draft.category_id}` : 'Not selected'}
              </p>
            </div>
            <button className="text-blue-600 text-sm hover:text-blue-700">Edit</button>
          </div>
        </div>

        <div 
          className="border border-gray-200 rounded-md p-4 cursor-pointer hover:border-blue-500 transition-colors"
          onClick={() => setCurrentStep(2)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-1">Media</h3>
              <p className="text-sm text-gray-600">{draft.media.length} items uploaded</p>
              {draft.media.length > 0 && (
                <div className="mt-2 flex space-x-2">
                  {draft.media.slice(0, 4).map((media, idx) => (
                    <img
                      key={idx}
                      src={media.url}
                      alt={`Preview ${idx + 1}`}
                      className="w-16 h-16 object-cover rounded"
                    />
                  ))}
                  {draft.media.length > 4 && (
                    <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center text-xs text-gray-600">
                      +{draft.media.length - 4}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="text-blue-600 text-sm hover:text-blue-700">Edit</button>
          </div>
        </div>

        <div 
          className="border border-gray-200 rounded-md p-4 cursor-pointer hover:border-blue-500 transition-colors"
          onClick={() => setCurrentStep(3)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-1">Pricing</h3>
              <p className="text-sm text-gray-600">
                Reserve: ${(draft.reserve_price_cents / 100).toFixed(2)} {draft.currency}
              </p>
            </div>
            <button className="text-blue-600 text-sm hover:text-blue-700">Edit</button>
          </div>
        </div>

        <div 
          className="border border-gray-200 rounded-md p-4 cursor-pointer hover:border-blue-500 transition-colors"
          onClick={() => setCurrentStep(4)}
        >
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-1">Location</h3>
              <p className="text-sm text-gray-600">
                {draft.city}, {draft.region}, {draft.country}
                {draft.postal_fsa && ` (${draft.postal_fsa})`}
              </p>
            </div>
            <button className="text-blue-600 text-sm hover:text-blue-700">Edit</button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="border-t border-gray-200 pt-4">
        <button
          onClick={handlePublish}
          disabled={!canPublish || publishing}
          className="w-full px-4 py-3 text-base font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {publishing ? 'Publishing...' : 'Publish Listing'}
        </button>
        {!canPublish && (
          <p className="mt-2 text-sm text-red-600 text-center">
            Please complete all required fields before publishing
          </p>
        )}
      </div>
    </div>
  );
}
