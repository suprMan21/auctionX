import { Router, RequestHandler } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getVerificationStatus,
  getDocumentUploadUrl,
  confirmDocumentUpload,
  submitForReview,
  deleteDocument,
} from '../controllers/sellerVerificationController';

// Mounted at /api/v1/seller-verification
export const sellerVerificationRoutes = Router();

// All routes require authentication
sellerVerificationRoutes.use(requireAuth as unknown as RequestHandler);

// Static routes
sellerVerificationRoutes.get('/status', getVerificationStatus as unknown as RequestHandler);
sellerVerificationRoutes.post('/upload-url', getDocumentUploadUrl as unknown as RequestHandler);
sellerVerificationRoutes.post('/documents', confirmDocumentUpload as unknown as RequestHandler);
sellerVerificationRoutes.post('/submit', submitForReview as unknown as RequestHandler);

// Parameterized route last (lesson #5)
sellerVerificationRoutes.delete('/documents/:docId', deleteDocument as unknown as RequestHandler);
