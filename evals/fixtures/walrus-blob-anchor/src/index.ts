import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { WalrusClient } from '@mysten/walrus';

const sui = new SuiJsonRpcClient({ network: 'mainnet' });
const walrus = new WalrusClient({ network: 'mainnet', suiClient: sui });

// TODO: implement `publishAndAnchor(blob: Uint8Array)` that
//   1. uploads the blob via walrus.writeBlob(...)
//   2. submits a Sui transaction creating a `BlobCommitment` Move object
//      that stores the returned blobId
//   3. returns { blobId, suiObjectId }
export async function publishAndAnchor(
  blob: Uint8Array,
): Promise<{ blobId: string; suiObjectId: string }> {
  throw new Error('not implemented');
}
