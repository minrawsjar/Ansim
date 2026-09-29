// The joiner's wallet lives on their phone. The key is made here, kept in this browser's storage, and never
// sent anywhere. It is a TRON Nile test wallet.
import { SigningKey, TypedDataEncoder, Wallet, concat, decodeBase58, encodeBase58, getBytes, hexlify, keccak256, sha256, toBeHex } from 'ethers';

// A TRON address is 0x41 followed by the last 20 bytes of keccak256(public key), in base58 with a
// 4-byte double-SHA-256 checksum.
export function tronAddress(privateKey: string) {
  const pub = SigningKey.computePublicKey(privateKey, false); // 0x04 · x · y
  const body = concat(['0x41', '0x' + keccak256('0x' + pub.slice(4)).slice(-40)]);
  return encodeBase58(concat([body, sha256(sha256(body)).slice(0, 10)]));
}

export const newWallet = () => {
  const privateKey = Wallet.createRandom().privateKey;
  return { privateKey, address: tronAddress(privateKey) };
};

// TIP-712 is EIP-712 with TRON addresses written as their 20-byte hex.
function hex20(base58: string) {
  const b = getBytes(toBeHex(decodeBase58(base58), 25));
  if (b[0] !== 0x41 || hexlify(b.slice(21)) !== sha256(sha256(b.slice(0, 21))).slice(0, 10)) throw new Error(`Not a TRON address: ${base58}`);
  return hexlify(b.slice(1, 21));
}

export type PermitDraft = {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, { name: string; type: string }[]>;
  message: { token: string; serviceProvider: string; user: string; receiver: string; value: string; maxFee: string; deadline: number; version: number; nonce: number };
};

// Signs a GasFree transfer permit on the phone. GasFree's controller checks this signature on chain and
// pays the network fee, so the wallet needs no TRX.
export function signPermit(privateKey: string, { domain, types, message }: PermitDraft) {
  const m = message;
  const digest = TypedDataEncoder.hash(
    { ...domain, verifyingContract: hex20(domain.verifyingContract) },
    types,
    { ...m, token: hex20(m.token), serviceProvider: hex20(m.serviceProvider), user: hex20(m.user), receiver: hex20(m.receiver) },
  );
  return new SigningKey(privateKey).sign(digest).serialized.slice(2);
}
