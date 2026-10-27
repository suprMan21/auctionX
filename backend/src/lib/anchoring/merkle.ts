/**
 * Daily Merkle root — S-ANCHOR1 Ph1.
 *
 * OpenZeppelin StandardMerkleTree, leaf type `bytes32`:
 *
 *   leaf = keccak256( keccak256( abi.encode(bytes32 ownershipId) ) )
 *   pair = keccak256( sorted(a, b) )
 *
 * Using the OZ library as-is means a verifier can check a Receipt with
 * `StandardMerkleTree.verify(root, ['bytes32'], [ownershipId], proof)` or
 * Solidity's `MerkleProof.verify`, with no AM code.
 *
 * Every root carries one random padding leaf. Without it, a day with a single
 * ownership event would publish a root that is a pure function of that one
 * Ownership ID, and a day with none could not be published at all.
 */

import { randomBytes } from 'crypto';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import type { Hex } from 'viem';

export const LEAF_ENCODING = ['bytes32'] as const;

export const LEAF_DESCRIPTION =
  'OpenZeppelin StandardMerkleTree, leaf = keccak256(keccak256(abi.encode(bytes32 ownershipId))), pairs hashed sorted';

const BYTES32 = /^0x[0-9a-f]{64}$/;

export const randomLeaf = (): Hex => `0x${randomBytes(32).toString('hex')}`;

export interface BuiltTree {
  readonly root: Hex;
  /** ownershipId → path to the root, in input order. */
  readonly proofs: ReadonlyMap<string, readonly Hex[]>;
}

export const buildDailyTree = (ownershipIds: readonly string[], paddingLeaf: Hex): BuiltTree => {
  const values = [...ownershipIds, paddingLeaf];
  for (const v of values) {
    if (!BYTES32.test(v)) throw new Error('merkle_value_not_bytes32');
  }
  if (new Set(values).size !== values.length) throw new Error('merkle_duplicate_value');

  const tree = StandardMerkleTree.of(values.map((v) => [v]), [...LEAF_ENCODING]);
  const proofs = new Map<string, Hex[]>();
  ownershipIds.forEach((id, index) => proofs.set(id, tree.getProof(index) as Hex[]));

  return { root: tree.root as Hex, proofs };
};

export const verifyInRoot = (root: string, ownershipId: string, proof: readonly string[]): boolean =>
  StandardMerkleTree.verify(root, [...LEAF_ENCODING], [ownershipId], [...proof]);
