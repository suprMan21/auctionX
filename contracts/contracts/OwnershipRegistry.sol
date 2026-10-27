// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title Authentic Materials Ownership Registry (S-ANCHOR1)
 *
 * A public, append-only log of ownership fingerprints. This is NOT an NFT:
 * nothing here is ownable, tradeable or held in anyone's wallet, and the
 * contract keeps no state about any item.
 *
 * Each value written is a 32-byte fingerprint and nothing else:
 *   - anchor(ownershipId)  one Ownership ID (per_event mode), or
 *   - anchorRoot(root)     the Merkle root of one day's Ownership IDs
 *                          (daily_batch mode, the launch default).
 * No tag UID, tag id, account id or email ever reaches this contract.
 *
 * Two roles, split on purpose:
 *   - writer (hot):  an AWS KMS key. Can only append. If stolen, it can add
 *                    junk entries but cannot edit or delete history.
 *   - owner (cold):  a hardware wallet held offline. Can only replace the
 *                    writer (or set it to zero to stop all writes during an
 *                    incident). Ownership moves in two steps, and cannot be
 *                    renounced, so the registry can never be left unrotatable.
 */
contract OwnershipRegistry is Ownable2Step {
    /// The only address allowed to append. Zero means writes are stopped.
    address public writer;

    /// One Ownership ID, per_event mode.
    event OwnershipAnchored(bytes32 indexed ownershipId, uint64 timestamp);

    /// One day's Merkle root (OpenZeppelin StandardMerkleTree, leaf type bytes32).
    event RootAnchored(bytes32 indexed merkleRoot, uint64 timestamp);

    event WriterChanged(address indexed previousWriter, address indexed newWriter);

    error NotWriter();
    error ZeroAddress();
    error WriterIsOwner();
    error RenounceDisabled();

    modifier onlyWriter() {
        if (msg.sender != writer || writer == address(0)) revert NotWriter();
        _;
    }

    constructor(address initialOwner, address initialWriter) Ownable(initialOwner) {
        if (initialWriter == address(0)) revert ZeroAddress();
        if (initialWriter == initialOwner) revert WriterIsOwner();
        writer = initialWriter;
        emit WriterChanged(address(0), initialWriter);
    }

    function anchor(bytes32 ownershipId) external onlyWriter {
        emit OwnershipAnchored(ownershipId, uint64(block.timestamp));
    }

    function anchorRoot(bytes32 merkleRoot) external onlyWriter {
        emit RootAnchored(merkleRoot, uint64(block.timestamp));
    }

    /// Replace the writer. address(0) stops all writes until a new writer is set.
    function setWriter(address newWriter) external onlyOwner {
        if (newWriter != address(0) && (newWriter == owner() || newWriter == pendingOwner())) revert WriterIsOwner();
        address previous = writer;
        writer = newWriter;
        emit WriterChanged(previous, newWriter);
    }

    /// The hot writer key must never become (or be lined up to become) the owner.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner != address(0) && newOwner == writer) revert WriterIsOwner();
        super.transferOwnership(newOwner);
    }

    /// An ownerless registry could never rotate a stolen writer key.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }
}
