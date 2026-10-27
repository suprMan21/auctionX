/**
 * OwnershipRegistry chain access — S-ANCHOR1 Ph1. Not an NFT.
 *
 * `ChainPort` is everything the anchoring tick needs from the chain, so the
 * tick can be tested against a fake. `createViemChainPort` is the real one:
 * reads over the configured RPC, writes signed by the KMS writer key.
 *
 * Sending is split in two (sign, then broadcast) so the tick can store the tx
 * hash BEFORE the transaction leaves the process. A crash between the two then
 * leaves a record of what might be in flight rather than an orphan write.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import type { AnchorConfig } from './config';
import type { KmsSigner } from './kmsSigner';

export const registryAbi = parseAbi([
  'function anchor(bytes32 ownershipId)',
  'function anchorRoot(bytes32 merkleRoot)',
  'function writer() view returns (address)',
  'event OwnershipAnchored(bytes32 indexed ownershipId, uint64 timestamp)',
  'event RootAnchored(bytes32 indexed merkleRoot, uint64 timestamp)',
  'event WriterChanged(address indexed previousWriter, address indexed newWriter)',
  // Watched so an owner-key change alerts (OpenZeppelin Ownable2Step).
  'event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
]);

export type AnchorFunction = 'anchor' | 'anchorRoot';

export type RegistryEvent =
  | { kind: 'OwnershipAnchored' | 'RootAnchored'; value: Hex; txHash: Hex; logIndex: number; blockNumber: bigint }
  | { kind: 'WriterChanged'; previousWriter: Hex; newWriter: Hex; txHash: Hex; logIndex: number; blockNumber: bigint }
  | { kind: 'OwnershipTransferStarted' | 'OwnershipTransferred'; previousOwner: Hex; newOwner: Hex; txHash: Hex; logIndex: number; blockNumber: bigint };

export interface SignedAnchor {
  readonly hash: Hex;
  readonly nonce: number;
  readonly raw: Hex;
}

export interface TxReceiptInfo {
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
}

export interface ChainPort {
  getBlockNumber(): Promise<bigint>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
  getBalance(address: Hex): Promise<bigint>;
  readWriter(): Promise<Hex>;
  getReceipt(hash: Hex): Promise<TxReceiptInfo | null>;
  /** True while the node still knows the tx (pending or mined). */
  isKnown(hash: Hex): Promise<boolean>;
  getRegistryEvents(fromBlock: bigint, toBlock: bigint): Promise<RegistryEvent[]>;
  signAnchor(fn: AnchorFunction, value: Hex): Promise<SignedAnchor>;
  broadcast(raw: Hex): Promise<Hex>;
}

const isNotFound = (err: unknown): boolean =>
  err instanceof Error && /not.?found|could not be found/i.test(`${err.name} ${err.message}`);

export const createViemChainPort = (config: AnchorConfig, signer: KmsSigner): ChainPort => {
  const transport = http(config.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account: signer.account, chain: baseSepolia, transport });
  const address = config.registryAddress;

  return {
    getBlockNumber: () => publicClient.getBlockNumber(),

    getBlockTimestamp: async (blockNumber) => (await publicClient.getBlock({ blockNumber })).timestamp,

    getBalance: (who) => publicClient.getBalance({ address: who }),

    readWriter: () => publicClient.readContract({ address, abi: registryAbi, functionName: 'writer' }),

    getReceipt: async (hash) => {
      try {
        const r = await publicClient.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    isKnown: async (hash) => {
      try {
        await publicClient.getTransaction({ hash });
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },

    getRegistryEvents: async (fromBlock, toBlock) => {
      const logs = await publicClient.getLogs({
        address,
        events: registryAbi.filter((item) => item.type === 'event'),
        fromBlock,
        toBlock,
        strict: true,
      });

      return logs.flatMap((log): RegistryEvent[] => {
        if (log.transactionHash === null || log.logIndex === null || log.blockNumber === null) return [];
        const base = { txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber };
        switch (log.eventName) {
          case 'OwnershipAnchored':
            return [{ kind: 'OwnershipAnchored', value: log.args.ownershipId, ...base }];
          case 'RootAnchored':
            return [{ kind: 'RootAnchored', value: log.args.merkleRoot, ...base }];
          case 'WriterChanged':
            return [{ kind: 'WriterChanged', previousWriter: log.args.previousWriter, newWriter: log.args.newWriter, ...base }];
          case 'OwnershipTransferStarted':
          case 'OwnershipTransferred':
            return [{ kind: log.eventName, previousOwner: log.args.previousOwner, newOwner: log.args.newOwner, ...base }];
          default:
            return [];
        }
      });
    },

    signAnchor: async (fn, value) => {
      const data = encodeFunctionData({ abi: registryAbi, functionName: fn, args: [value] });
      const request = await walletClient.prepareTransactionRequest({
        account: signer.account,
        chain: baseSepolia,
        to: address,
        data,
      });
      const raw = await walletClient.signTransaction(request);
      return { hash: keccak256(raw), nonce: request.nonce, raw };
    },

    broadcast: (raw) => walletClient.sendRawTransaction({ serializedTransaction: raw }),
  };
};
