import { onRequest } from 'firebase-functions/v2/https'
import app from './v1/index'

export const api = onRequest(
  {
    region: 'us-central1',
    cors: true,
  },
  app
)
