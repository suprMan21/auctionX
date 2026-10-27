/**
 * Anchoring config — S-ANCHOR1 Ph1.
 *
 * Everything comes from App Runner env (literals). The writer key never does:
 * only its KMS key id, and the key itself never leaves KMS.
 *
 *   ANCHOR_MODE                    daily_batch (default, Locked 2026-10-27) | per_event
 *   ANCHOR_CHAIN_ID                84532 (Base Sepolia). Base mainnet is refused in Ph1.
 *   ANCHOR_RPC_URL                 Base Sepolia RPC (Alchemy per Decisions DB)
 *   ANCHOR_REGISTRY_ADDRESS        OwnershipRegistry address
 *   ANCHOR_REGISTRY_DEPLOY_BLOCK   first block the reconciliation scan reads
 *   ANCHOR_KMS_KEY_ID              alias/am-anchor-writer-staging
 *   ANCHOR_LOW_BALANCE_WEI         alert below this writer balance (default 0.002 ETH)
 *   ANCHOR_CONFIRMATIONS           blocks before a batch counts as anchored (default 3)
 *
 * Not configured means the tick does nothing and says so. It never guesses.
 */

import { getAddress, isAddress } from 'viem';

export type AnchorMode = 'daily_batch' | 'per_event';

export const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_MAINNET_CHAIN_ID = 8453;

export interface AnchorConfig {
  readonly mode: AnchorMode;
  readonly chainId: number;
  readonly rpcUrl: string;
  /** Checksummed for viem; stored lowercase in the database. */
  readonly registryAddress: `0x${string}`;
  readonly deployBlock: bigint;
  readonly kmsKeyId: string;
  readonly lowBalanceWei: bigint;
  readonly confirmations: number;
  /** Most per_event sends in one tick: the rate limit a stolen tick cannot lift. */
  readonly maxSendsPerTick: number;
  /** Blocks per eth_getLogs call; public RPCs cap the range. */
  readonly logChunkBlocks: bigint;
  /** Chunks per tick, so a long gap catches up over several ticks. */
  readonly maxLogChunksPerTick: number;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: AnchorConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

const DEFAULT_LOW_BALANCE_WEI = 2_000_000_000_000_000n; // 0.002 ETH

const env = (name: string): string => process.env[name]?.trim() ?? '';

const positiveInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(env(name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const readAnchorConfig = (): ConfigResult => {
  const missing: string[] = [];

  const rawMode = env('ANCHOR_MODE') || 'daily_batch';
  if (rawMode !== 'daily_batch' && rawMode !== 'per_event') missing.push('ANCHOR_MODE');

  const chainId = Number.parseInt(env('ANCHOR_CHAIN_ID') || String(BASE_SEPOLIA_CHAIN_ID), 10);
  // Ph1 is testnet only: mainnet needs counsel sign-off and the privacy-policy
  // disclosure first (Decisions DB 2026-10-27). Lifting this is a code change.
  if (chainId !== BASE_SEPOLIA_CHAIN_ID) missing.push('ANCHOR_CHAIN_ID');
  if (chainId === BASE_MAINNET_CHAIN_ID) missing.push('ANCHOR_CHAIN_ID (mainnet is not allowed in Ph1)');

  const rpcUrl = env('ANCHOR_RPC_URL');
  if (!/^https:\/\//.test(rpcUrl)) missing.push('ANCHOR_RPC_URL');

  const registry = env('ANCHOR_REGISTRY_ADDRESS');
  if (!isAddress(registry, { strict: false })) missing.push('ANCHOR_REGISTRY_ADDRESS');

  const deployBlockRaw = env('ANCHOR_REGISTRY_DEPLOY_BLOCK');
  if (!/^\d+$/.test(deployBlockRaw)) missing.push('ANCHOR_REGISTRY_DEPLOY_BLOCK');

  const kmsKeyId = env('ANCHOR_KMS_KEY_ID');
  if (!kmsKeyId) missing.push('ANCHOR_KMS_KEY_ID');

  const lowRaw = env('ANCHOR_LOW_BALANCE_WEI');
  const lowBalanceWei = /^\d+$/.test(lowRaw) ? BigInt(lowRaw) : DEFAULT_LOW_BALANCE_WEI;

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      mode: rawMode as AnchorMode,
      chainId,
      rpcUrl,
      registryAddress: getAddress(registry),
      deployBlock: BigInt(deployBlockRaw),
      kmsKeyId,
      lowBalanceWei,
      confirmations: positiveInt('ANCHOR_CONFIRMATIONS', 3),
      maxSendsPerTick: positiveInt('ANCHOR_MAX_SENDS_PER_TICK', 10),
      logChunkBlocks: BigInt(positiveInt('ANCHOR_LOG_CHUNK_BLOCKS', 2000)),
      maxLogChunksPerTick: positiveInt('ANCHOR_MAX_LOG_CHUNKS_PER_TICK', 50),
    },
  };
};

export const explorerTxUrl = (chainId: number, txHash: string): string | null =>
  chainId === BASE_SEPOLIA_CHAIN_ID ? `https://sepolia.basescan.org/tx/${txHash}` : null;
