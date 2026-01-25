import { Router } from 'express'
import { generateUploadUrl, getPublicUrl, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from '../lib/s3'

const router = Router()

router.post('/upload-url', async (req, res): Promise<void> => {
  try {
    const { key, contentType } = req.body

    if (!key || typeof key !== 'string') {
      res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Missing or invalid "key" parameter'
      })
      return
    }

    if (!contentType || typeof contentType !== 'string') {
      res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Missing or invalid "contentType" parameter'
      })
      return
    }

    const isImage = ALLOWED_IMAGE_TYPES.includes(contentType)
    const isVideo = ALLOWED_VIDEO_TYPES.includes(contentType)

    if (!isImage && !isVideo) {
      res.status(400).json({
        error: 'INVALID_CONTENT_TYPE',
        message: `Content type must be one of: ${[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(', ')}`
      })
      return
    }

    const uploadUrl = await generateUploadUrl({
      key,
      contentType,
      expiresIn: 300 // 5 minutes
    })

    const publicUrl = getPublicUrl(key)

    res.json({
      uploadUrl,
      publicUrl,
      key,
      expiresIn: 300
    })
  } catch (error: any) {
    console.error('[media/upload-url] Error:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message || 'Failed to generate upload URL'
    })
  }
})

export default router
