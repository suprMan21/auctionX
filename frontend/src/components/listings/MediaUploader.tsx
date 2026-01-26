import { useRef, useState } from 'react';
import { useListingCreation, ListingMedia } from '../../stores/listingCreationStore';
import { supabase } from '../../features/auth/lib/supabase';

const MAX_MEDIA = 10;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_VIDEO_TYPES = ['video/mp4'];

export function MediaUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const { draft, addMedia, removeMedia, reorderMedia, updateMedia } = useListingCreation();

  const validateFile = (file: File): string | null => {
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);

    if (!isImage && !isVideo) {
      return 'Invalid file type. Please upload JPG, PNG, WebP, GIF, or MP4 files.';
    }

    if (isImage && file.size > MAX_IMAGE_SIZE) {
      return 'Image must be smaller than 5MB';
    }

    if (isVideo && file.size > MAX_VIDEO_SIZE) {
      return 'Video must be smaller than 50MB';
    }

    return null;
  };

  const uploadToS3 = async (file: File, index: number) => {
    updateMedia(index, { uploading: true, uploadProgress: 0 });

    try {
      const { data: urlData, error: urlError } = await supabase.functions.invoke('upload-url', {
        body: {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        },
      });

      if (urlError) throw urlError;

      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          updateMedia(index, { uploadProgress: progress });
        }
      });

      await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(xhr.response);
          } else {
            reject(new Error('Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.open('PUT', urlData.uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      updateMedia(index, {
        s3_key: urlData.key,
        s3_bucket: urlData.bucket,
        url: urlData.url,
        uploading: false,
        uploadProgress: 100,
      });
    } catch (error: any) {
      updateMedia(index, {
        uploading: false,
        error: error.message,
      });
    }
  };

  const handleFiles = async (files: FileList) => {
    const remainingSlots = MAX_MEDIA - draft.media.length;
    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    for (const file of filesToProcess) {
      const error = validateFile(file);
      if (error) {
        alert(error);
        continue;
      }

      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);
      const newMedia: ListingMedia = {
        file,
        type: isImage ? 'IMAGE' : 'VIDEO',
        size_bytes: file.size,
        sort_order: draft.media.length,
        uploading: true,
        uploadProgress: 0,
      };

      addMedia(newMedia);
      const index = draft.media.length;
      await uploadToS3(file, index);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropReorder = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
    if (fromIndex !== toIndex) {
      reorderMedia(fromIndex, toIndex);
    }
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${draft.media.length >= MAX_MEDIA ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => draft.media.length < MAX_MEDIA && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload media files"
      >
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          stroke="currentColor"
          fill="none"
          viewBox="0 0 48 48"
        >
          <path
            d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="mt-2 text-sm text-gray-600">
          {draft.media.length >= MAX_MEDIA
            ? 'Maximum 10 media items reached'
            : 'Click to upload or drag and drop'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {draft.media.length}/{MAX_MEDIA} media items
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(',')}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
        className="hidden"
      />

      {draft.media.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {draft.media.filter(m => !m.error).map((media, index) => (
            <div
              key={index}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropReorder(e, index)}
              className="relative aspect-square border-2 border-gray-300 rounded-lg overflow-hidden group cursor-move"
            >
              {index === 0 && (
                <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded z-10">
                  Primary
                </div>
              )}

              {media.uploading ? (
                <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-gray-600 mt-2">
                      {Math.round(media.uploadProgress || 0)}%
                    </p>
                  </div>
                </div>
              ) : media.error ? (
                <div className="absolute inset-0 bg-red-50 flex items-center justify-center p-4">
                  <p className="text-xs text-red-600 text-center">{media.error}</p>
                </div>
              ) : media.url ? (
                <>
                  {media.type === 'IMAGE' ? (
                    <img
                      src={media.url}
                      alt={`Upload ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <video
                      src={media.url}
                      className="w-full h-full object-cover"
                      muted
                    />
                  )}
                </>
              ) : null}

              <button
                onClick={() => removeMedia(index)}
                className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label={`Remove media ${index + 1}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
