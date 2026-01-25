import { useState, useRef } from 'react'
import { uploadProfilePhoto, S3UploadError } from '../lib/s3Upload'
import { useUpdateProfile } from '../hooks/useProfile'

interface PhotoUploadButtonProps {
  userId: string
  onUploadComplete?: (photoUrl: string) => void
}

export function PhotoUploadButton({ userId, onUploadComplete }: PhotoUploadButtonProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { updateProfile } = useUpdateProfile()

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setUploading(true)
      setProgress(0)
      setError(null)

      const result = await uploadProfilePhoto(file, userId, (p) => {
        setProgress(p.percentage)
      })

      await updateProfile({ photo_url: result.publicUrl })

      onUploadComplete?.(result.publicUrl)
      
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err) {
      if (err instanceof S3UploadError) {
        setError(err.message)
        console.error('[PhotoUploadButton] Upload error:', {
          message: err.message,
          code: err.code,
          statusCode: err.statusCode,
        })
      } else {
        setError('Upload failed. Please try again.')
        console.error('[PhotoUploadButton] Unknown error:', err)
      }
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        disabled={uploading}
        className="hidden"
        id="photo-upload"
      />
      <label
        htmlFor="photo-upload"
        className={`inline-block px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
          uploading
            ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {uploading ? `Uploading... ${progress}%` : 'Upload Photo'}
      </label>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {uploading && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
