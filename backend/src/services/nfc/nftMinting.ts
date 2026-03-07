import { createWalletClient, createPublicClient, http, parseEventLogs, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';

const MINT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    name: 'NFTMinted',
    type: 'event',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'tokenURI', type: 'string', indexed: false },
    ],
  },
] as const;

function getChain() {
  const chainId = Number(process.env.CHAIN_ID || '84532');
  return chainId === 8453 ? base : baseSepolia;
}

export const mintNftOnChain = async (
  metadataUri: string,
  recipientWallet?: string,
): Promise<{
  txHash: string;
  tokenId: string;
  ownerWallet: string;
  chain: string;
  contractAddress: string;
}> => {
  const privateKey = process.env.MINTER_PRIVATE_KEY as Hex;
  if (!privateKey) throw new Error('MINTER_PRIVATE_KEY not configured');

  const contractAddress = process.env.NFT_CONTRACT_ADDRESS as Hex;
  if (!contractAddress) throw new Error('NFT_CONTRACT_ADDRESS not configured');

  const chain = getChain();
  const account = privateKeyToAccount(privateKey);
  const recipient = (recipientWallet as Hex) || account.address;

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(process.env.BASE_RPC_URL || undefined),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(process.env.BASE_RPC_URL || undefined),
  });

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: MINT_ABI,
    functionName: 'mint',
    args: [recipient, metadataUri],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  const logs = parseEventLogs({
    abi: MINT_ABI,
    logs: receipt.logs,
    eventName: 'NFTMinted',
  });

  const tokenId = logs.length > 0 ? logs[0].args.tokenId.toString() : '0';

  return {
    txHash,
    tokenId,
    ownerWallet: recipient,
    chain: chain.name,
    contractAddress,
  };
};
