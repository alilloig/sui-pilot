import { SuiClient } from '@mysten/sui/client';

const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io' });

export async function getOwnedObjects(addr: string) {
  return client.getOwnedObjects({ owner: addr });
}
