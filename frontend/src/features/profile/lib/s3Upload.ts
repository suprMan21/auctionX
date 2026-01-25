const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/auctionx-dev/us-central1'

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export interface UploadResult {
  key: string
  publicUrl: string
}

export class S3UploadError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'S3UploadError'
  }
}

export async function uploadProfilePhoto(
  file: File,
  userId: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  try {
    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      throw new S3UploadError(
        'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.',
        'INVALID_FILE_TYPE'
      )
    }

    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      throw new S3UploadError(
        'File size exceeds 5MB limit.',
        'FILE_TOO_LARGE'
      )
    }

    // Generate unique key
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const key = `profiles/${userId}/${timestamp}_${sanitizedName}`

    // Get pre-signed URL from backend
    const presignResponse = await fetch(`${API_BASE_URL}/v1/media/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        contentType: file.type,
      }),
    })

    if (!presignResponse.ok) {
      const error = await presignResponse.json().catch(() => ({}))
      throw new S3UploadError(
        error.message || 'Failed to get upload URL',
        'PRESIGN_FAILED',
        presignResponse.status
      )
    }

    const { uploadUrl, publicUrl } = await presignResponse.json()

    // Upload to S3 with progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({
            loaded: e.loaded,
            total: e.total,
            percentage: Math.round((e.loaded / e.total) * 100),
          })
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new S3UploadError(
            'Upload failed',
            'UPLOAD_FAILED',
            xhr.status
          ))
        }
      })

      xhr.addEventListener('error', () => {
        reject(new S3UploadError(
          'Network error during upload',
          'NETWORK_ERROR'
        ))
      })

      xhr.addEventListener('abort', () => {
        reject(new S3UploadError(
          'Upload aborted',
          'UPLOAD_ABORTED'
        ))
      })

      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)
    })

    return { key, publicUrl }
  } catch (error) {
    if (error instanceof S3UploadError) {
      throw error
    }
    throw new S3UploadError(
      error instanceof Error ? error.message : 'Upload failed',
      'UNKNOWN_ERROR'
    )
  }
}
