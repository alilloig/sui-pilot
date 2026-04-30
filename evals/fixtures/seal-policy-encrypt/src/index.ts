import { SealClient } from '@mysten/seal';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';

const sui = new SuiJsonRpcClient({ network: 'mainnet' });

// TODO: implement `encryptForCapability(secret, capabilityId)` using
// SealClient.encrypt with a capability-gated decryption policy that
// references the given capabilityId.
export async function encryptForCapability(
  secret: Uint8Array,
  capabilityId: string,
): Promise<Uint8Array> {
  throw new Error('not implemented');
}
