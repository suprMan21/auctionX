import express from 'express'
import cors from 'cors'
import mediaRouter from './routes/media'

const app = express()

app.use(cors({ origin: true }))
app.use(express.json())

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/v1/media', mediaRouter)

export default app
