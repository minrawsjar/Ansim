// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AnsimRegistry
/// @notice Public record for Ansim payouts on TRON. It never holds or moves money: payments go
/// through GasFree, bounded by each signed permit's fee cap and deadline. This contract records who
/// granted which spending policy, when it was stopped, and a hash of each finished batch's event log,
/// so an auditor can check Ansim's off-chain records against the chain.
contract AnsimRegistry {
    /// The Ansim backend key allowed to write records.
    address public immutable notary;

    struct PolicyRecord {
        bytes32 policyHash; // sha256 over the signed policy fields and the owner's signature
        address payer;      // account that pays through GasFree
        address owner;      // account that signed the policy
        uint256 budget;     // USDT base units, fees included
        uint256 perPayment; // USDT base units
        uint64 deadline;    // unix seconds
        uint64 grantedAt;
        uint64 stoppedAt;   // 0 while active
    }

    struct BatchSeal {
        bytes32 logHash;    // hash of the batch's BATCH_CLOSED event in the hash-chained log
        uint256 policyId;
        uint32 paid;
        uint32 refused;
        uint256 amountPaid; // USDT base units
        uint256 fees;       // USDT base units
        uint64 sealedAt;
    }

    mapping(uint256 => PolicyRecord) public policies;
    mapping(uint256 => BatchSeal) public batches;

    event PolicyGranted(uint256 indexed policyId, bytes32 policyHash, address indexed payer, address indexed owner, uint256 budget, uint256 perPayment, uint64 deadline);
    event PolicyStopped(uint256 indexed policyId, uint64 stoppedAt);
    event BatchSealed(uint256 indexed batchId, uint256 indexed policyId, bytes32 logHash, uint32 paid, uint32 refused, uint256 amountPaid, uint256 fees);

    error NotNotary();
    error AlreadyRecorded();
    error UnknownPolicy();

    modifier onlyNotary() {
        if (msg.sender != notary) revert NotNotary();
        _;
    }

    constructor() {
        notary = msg.sender;
    }

    function grantPolicy(
        uint256 policyId,
        bytes32 policyHash,
        address payer,
        address owner,
        uint256 budget,
        uint256 perPayment,
        uint64 deadline
    ) external onlyNotary {
        if (policies[policyId].grantedAt != 0) revert AlreadyRecorded();
        policies[policyId] = PolicyRecord(policyHash, payer, owner, budget, perPayment, deadline, uint64(block.timestamp), 0);
        emit PolicyGranted(policyId, policyHash, payer, owner, budget, perPayment, deadline);
    }

    function stopPolicy(uint256 policyId) external onlyNotary {
        PolicyRecord storage p = policies[policyId];
        if (p.grantedAt == 0) revert UnknownPolicy();
        if (p.stoppedAt != 0) revert AlreadyRecorded();
        p.stoppedAt = uint64(block.timestamp);
        emit PolicyStopped(policyId, p.stoppedAt);
    }

    function sealBatch(
        uint256 batchId,
        uint256 policyId,
        bytes32 logHash,
        uint32 paid,
        uint32 refused,
        uint256 amountPaid,
        uint256 fees
    ) external onlyNotary {
        if (batches[batchId].sealedAt != 0) revert AlreadyRecorded();
        batches[batchId] = BatchSeal(logHash, policyId, paid, refused, amountPaid, fees, uint64(block.timestamp));
        emit BatchSealed(batchId, policyId, logHash, paid, refused, amountPaid, fees);
    }
}
