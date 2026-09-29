// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ITRC20 {
    function balanceOf(address account) external view returns (uint256);
}

/// @title AnsimVault
/// @notice Holds the operator's USDT. Money leaves only to the payer's GasFree account, only for a batch
/// the owner approved with a TIP-712 signature, once per batch, and never more than the approved total
/// plus GasFree's fee per payment. Each signed approval works once. The owner can freeze the vault at any time.
/// @dev The approval is the same BatchApproval typed data the owner signs in TronLink, so a compromised
/// Ansim backend cannot move more than one approved batch: it cannot forge the owner's signature.
contract AnsimVault {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 private constant APPROVAL_TYPEHASH =
        keccak256("BatchApproval(uint256 batchId,uint256 policyId,bytes32 rowsHash,uint256 count,uint256 total)");
    bytes4 private constant TRANSFER = 0xa9059cbb; // transfer(address,uint256)

    address public immutable token;
    address public immutable agent; // Ansim's notary key: the only caller of release
    address public immutable payout; // the payer's GasFree account: the only place a release can go
    uint256 public immutable feePerPayment; // GasFree's fee per transfer, released on top of the approved total
    bytes32 public immutable domainSeparator;

    address public owner;
    bool public frozen;
    mapping(bytes32 => uint256) public released; // approval digest => amount released, so each approval works once

    event Released(uint256 indexed batchId, bytes32 indexed digest, uint256 policyId, bytes32 rowsHash, uint256 count, uint256 total, uint256 amount);
    event Frozen(bool frozen);
    event OwnerChanged(address indexed owner);
    event Withdrawn(address indexed to, uint256 amount);

    error NotAgent();
    error NotOwner();
    error VaultFrozen();
    error AlreadyReleased();
    error BadSignature();
    error TransferFailed();

    constructor(address token_, address owner_, address agent_, address payout_, uint256 feePerPayment_, uint256 chainId_) {
        token = token_;
        owner = owner_;
        agent = agent_;
        payout = payout_;
        feePerPayment = feePerPayment_;
        domainSeparator = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Ansim"), keccak256("1"), chainId_));
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice The digest the owner signs for a batch approval (TIP-712).
    function approvalDigest(uint256 batchId, uint256 policyId, bytes32 rowsHash, uint256 count, uint256 total) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(APPROVAL_TYPEHASH, batchId, policyId, rowsHash, count, total));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /// @notice Who signed this approval, or the zero address if the signature is malformed.
    function approver(uint256 batchId, uint256 policyId, bytes32 rowsHash, uint256 count, uint256 total, bytes calldata sig) public view returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // Reject the malleable upper half of s, as OpenZeppelin's ECDSA does.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(approvalDigest(batchId, policyId, rowsHash, count, total), v, r, s);
    }

    /// @notice Sends one approved batch's money to the payer's GasFree account.
    function release(uint256 batchId, uint256 policyId, bytes32 rowsHash, uint256 count, uint256 total, bytes calldata sig) external {
        if (msg.sender != agent) revert NotAgent();
        if (frozen) revert VaultFrozen();
        bytes32 digest = approvalDigest(batchId, policyId, rowsHash, count, total);
        if (released[digest] != 0) revert AlreadyReleased();
        address signer = approver(batchId, policyId, rowsHash, count, total, sig);
        if (signer == address(0) || signer != owner) revert BadSignature();
        uint256 amount = total + count * feePerPayment;
        released[digest] = amount;
        _send(payout, amount);
        emit Released(batchId, digest, policyId, rowsHash, count, total, amount);
    }

    function setFrozen(bool frozen_) external onlyOwner {
        frozen = frozen_;
        emit Frozen(frozen_);
    }

    function setOwner(address owner_) external onlyOwner {
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    /// @notice The owner can always take the money out, frozen or not.
    function withdraw(address to, uint256 amount) external onlyOwner {
        _send(to, amount);
        emit Withdrawn(to, amount);
    }

    // Checks the balance change instead of the return value: TRON's USDT does not return true reliably.
    function _send(address to, uint256 amount) private {
        uint256 before = ITRC20(token).balanceOf(to);
        (bool ok, ) = token.call(abi.encodeWithSelector(TRANSFER, to, amount));
        if (!ok || ITRC20(token).balanceOf(to) != before + amount) revert TransferFailed();
    }
}
