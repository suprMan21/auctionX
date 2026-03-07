import { z } from 'zod';

const hexString = (length?: number) => {
  const base = z.string().regex(/^[0-9a-fA-F]+$/, 'Must be a hex string');
  return length ? base.length(length) : base;
};

export const registerTagSchema = z.object({
  tagUid: hexString().min(8).max(14),
  aesKey: hexString(32), // 16 bytes = 32 hex chars
  itemId: z.string().uuid().optional(),
  tenantId: z.string().min(1).max(64).default('auctionx'),
});

export const scanTagSchema = z.union([
  z.object({ sunMessage: z.string().url() }),
  z.object({
    piccData: hexString(),
    cmac: hexString(16),
    tagUid: hexString().min(8).max(14),
  }),
]);

export const uploadProofSchema = z.object({
  tagId: z.string().uuid(),
  contentType: z.string().regex(/^video\//, 'Must be a video MIME type'),
  fileSize: z.number().int().positive().max(50 * 1024 * 1024), // 50MB max
});

export const transferSchema = z.object({
  tagId: z.string().uuid(),
  toUserId: z.string().uuid(),
  transferType: z.enum(['sale', 'gift', 'return']).default('sale'),
  transactionId: z.string().uuid().optional(),
});

export const mintSchema = z.object({
  tagId: z.string().uuid(),
});

export type RegisterTagInput = z.infer<typeof registerTagSchema>;
export type ScanTagInput = z.infer<typeof scanTagSchema>;
export type UploadProofInput = z.infer<typeof uploadProofSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type MintInput = z.infer<typeof mintSchema>;
