import { NftData } from '../types/verification';

interface NftSectionProps {
  nft: NftData | null;
}

const CopyIcon = ({ onClick }: { onClick: () => void }) => (
  <svg
    onClick={onClick}
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-gray-500 hover:text-white cursor-pointer ml-1.5 inline shrink-0"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="inline ml-1.5 shrink-0"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const truncate = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;

const copy = (value: string) => {
  navigator.clipboard.writeText(value).catch(() => {});
};

export const NftSection = ({ nft }: NftSectionProps) => {
  if (nft === null) return null;

  const { chain, contract_address, token_id, mint_tx_hash, metadata_uri } = nft;

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">On-Chain Proof</h3>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-900/40 border border-blue-700/50 text-blue-300">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="#60a5fa" xmlns="http://www.w3.org/2000/svg">
            <circle cx="4" cy="4" r="4" />
          </svg>
          {chain}
        </span>
      </div>

      <div className="flex justify-between items-center py-2 border-b border-white/5 text-sm">
        <span className="text-gray-400">Contract</span>
        <span className="text-white font-mono flex items-center">
          {truncate(contract_address)}
          <CopyIcon onClick={() => copy(contract_address)} />
          <a
            href={`https://basescan.org/address/${contract_address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-white"
          >
            <ExternalLinkIcon />
          </a>
        </span>
      </div>

      <div className="flex justify-between items-center py-2 border-b border-white/5 text-sm">
        <span className="text-gray-400">Token ID</span>
        <span className="text-white font-mono">{token_id}</span>
      </div>

      <div className="flex justify-between items-center py-2 border-b border-white/5 text-sm">
        <span className="text-gray-400">Transaction</span>
        <span className="text-white font-mono flex items-center">
          {truncate(mint_tx_hash)}
          <CopyIcon onClick={() => copy(mint_tx_hash)} />
          <a
            href={`https://basescan.org/tx/${mint_tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-white"
          >
            <ExternalLinkIcon />
          </a>
        </span>
      </div>

      <a
        href={`https://basescan.org/tx/${mint_tx_hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 w-full py-2.5 rounded-xl bg-blue-900/30 border border-blue-700/40 text-blue-300 hover:bg-blue-900/50 text-sm font-medium transition-colors text-center block"
      >
        View NFT on Base
      </a>

      {metadata_uri && (
        <a
          href={metadata_uri}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 hover:text-white text-sm font-medium transition-colors text-center block"
        >
          View Metadata (IPFS)
        </a>
      )}
    </div>
  );
};
