import { supabase } from '@/lib/supabase';

export class S3UploadError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'S3UploadError';
  }
}

interface UploadProgress {
  percentage: number;
  loaded: number;
  total: number;
}

interface UploadResult {
  publicUrl: string;
  s3Key: string;
}

export async function uploadProfilePhoto(
  file: File,
  userId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new S3UploadError('Not authenticated', 'AUTH_REQUIRED', 401);
  }

  onProgress?.({ percentage: 10, loaded: 0, total: file.size });

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        type: "profile",
        userId,
        filename: file.name,
        contentType: file.type,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new S3UploadError(
      error.error || "Failed to get upload URL",
      error.error,
      response.status
    );
  }

  const { uploadUrl, publicUrl, s3Key } = await response.json();

  onProgress?.({ percentage: 30, loaded: 0, total: file.size });

  const xhr = new XMLHttpRequest();

  const uploadPromise = new Promise<void>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentage = 30 + Math.round((e.loaded / e.total) * 60);
        onProgress?.({
          percentage,
          loaded: e.loaded,
          total: e.total,
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new S3UploadError('Failed to upload to S3', 'S3_UPLOAD_FAILED', xhr.status));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new S3UploadError('Network error during upload', 'NETWORK_ERROR'));
    });

    xhr.addEventListener('abort', () => {
      reject(new S3UploadError('Upload cancelled', 'UPLOAD_CANCELLED'));
    });

    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });

  await uploadPromise;

  onProgress?.({ percentage: 100, loaded: file.size, total: file.size });

  return { publicUrl, s3Key };
}
