/**
 * NFC chip-key configuration — Zod-validated, read on every call (no caching,
 * so a test or an env flip is never served a stale provider).
 *
 *   NFC_KEY_PROVIDER        kms | local          (default kms — fail closed)
 *   NFC_KMS_SDM_KEY_ID      default alias/am-tag-sdm-staging (SDM root: META + FILE)
 *   NFC_KMS_REGION          default us-east-2
 *   NFC_LOCAL_SDM_ROOT_KEY  64 hex chars (op://AM_Development/NFC Local Root/sdm-key)
 *   NFC_ALLOW_LOCAL_KEYS    true | false        (default false)
 *   NFC_SDM_KEY_VERSION     1..255, version stamped on newly enrolled chips (default 1)
 *
 * Amended 2026-10-01 by Boss (per-role KMS roots): the backend is configured
 * with the SDM root only. There is deliberately no setting for the encoder's
 * second root — the backend must not be configurable into deriving
 * application master keys.
 */

import { z } from 'zod';
import {
  createKmsTagKeyProvider,
  createLocalTagKeyProvider,
  type KmsMacClient,
  type TagKeyProvider,
} from './tagKeyProvider';

const boolFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const nfcKeyConfigSchema = z.object({
  NFC_KEY_PROVIDER: z.enum(['kms', 'local']).default('kms'),
  NFC_KMS_SDM_KEY_ID: z.string().min(1).default('alias/am-tag-sdm-staging'),
  NFC_KMS_REGION: z.string().min(1).default('us-east-2'),
  NFC_LOCAL_SDM_ROOT_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'NFC_LOCAL_SDM_ROOT_KEY must be 64 hex chars')
    .optional(),
  NFC_ALLOW_LOCAL_KEYS: boolFlag,
  NFC_SDM_KEY_VERSION: z.coerce.number().int().min(1).max(255).default(1),
});

export type NfcKeyConfig = z.infer<typeof nfcKeyConfigSchema>;

/** Treats empty-string env vars as unset, so `.default()` applies. */
const pickEnv = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(nfcKeyConfigSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
};

export const readNfcKeyConfig = (env: NodeJS.ProcessEnv = process.env): NfcKeyConfig => {
  const parsed = nfcKeyConfigSchema.safeParse(pickEnv(env));
  if (!parsed.success) {
    // Field names only — never echo a value (one of them is a root key).
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid NFC key configuration: ${fields}`);
  }
  return parsed.data;
};

export const getTagKeyProvider = (
  env: NodeJS.ProcessEnv = process.env,
  kmsClient?: KmsMacClient,
): TagKeyProvider => {
  const cfg = readNfcKeyConfig(env);
  if (cfg.NFC_KEY_PROVIDER === 'local') {
    return createLocalTagKeyProvider({
      sdmRootKeyHex: cfg.NFC_LOCAL_SDM_ROOT_KEY,
      allowLocalKeys: cfg.NFC_ALLOW_LOCAL_KEYS,
    });
  }
  return createKmsTagKeyProvider({
    keyId: cfg.NFC_KMS_SDM_KEY_ID,
    region: cfg.NFC_KMS_REGION,
    client: kmsClient,
  });
};

/** Version stamped on chips enrolled now. Older versions stay verifiable. */
export const currentSdmKeyVersion = (env: NodeJS.ProcessEnv = process.env): number =>
  readNfcKeyConfig(env).NFC_SDM_KEY_VERSION;
