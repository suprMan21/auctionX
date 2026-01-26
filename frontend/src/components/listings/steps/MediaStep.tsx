import { useListingCreation, ListingMedia } from '../../../stores/listingCreationStore';
import { MediaUploader } from '../MediaUploader';

export function MediaStep() {
  const { draft } = useListingCreation();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-2">Add Photos & Videos</h2>
        <p className="text-sm text-gray-600 mb-1">
          Upload up to 10 photos or videos. The first image will be your primary photo.
        </p>
        <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
          <li>Images: JPG, PNG, WebP, GIF (max 5MB each)</li>
          <li>Videos: MP4 (max 50MB each)</li>
          <li>At least 1 photo required to publish</li>
        </ul>
      </div>

      <MediaUploader />

      {draft.media.length === 0 && (
        <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-md">
          <p className="text-sm text-gray-500">No media uploaded yet</p>
        </div>
      )}
    </div>
  );
}
