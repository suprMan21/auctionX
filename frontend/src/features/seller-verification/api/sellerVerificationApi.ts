import { supabase } from '@/lib/supabase';
import type { VerificationStatusResponse, DocumentUploadUrlResponse, DocumentType, VerificationDocument } from '../types/sellerVerification';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${session.access_token}` };
}

export const sellerVerificationApi = {
  async getStatus(): Promise<VerificationStatusResponse> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/seller-verification/status`, { headers });
    if (!response.ok) throw new Error('Failed to fetch verification status');
    const json = await response.json();
    return json.data;
  },

  async getUploadUrl(documentType: DocumentType, mimeType: string): Promise<DocumentUploadUrlResponse> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/seller-verification/upload-url`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentType, mimeType }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to get upload URL');
    }
    const json = await response.json();
    return json.data;
  },

  async confirmUpload(params: {
    documentType: DocumentType;
    s3Key: string;
    fileUrl: string;
    mimeType: string;
    fileSizeBytes: number;
  }): Promise<VerificationDocument> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/seller-verification/documents`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to confirm upload');
    }
    const json = await response.json();
    return json.data;
  },

  async submit(): Promise<{ status: string; submittedAt: string }> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/seller-verification/submit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to submit for review');
    }
    const json = await response.json();
    return json.data;
  },

  async deleteDocument(docId: string): Promise<void> {
    const headers = await getAuthHeader();
    const response = await fetch(`${API_URL}/seller-verification/documents/${docId}`, {
      method: 'DELETE',
      headers,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete document');
    }
  },
};
