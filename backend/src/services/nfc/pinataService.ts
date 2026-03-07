import { PinataSDK } from 'pinata-web3';

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY_URL?.replace('https://', '') || 'gateway.pinata.cloud',
});

interface NftAttributes {
  tag_uid: string;
  scan_count: number;
  seller: string;
  verification_status: string;
  platform: string;
}

interface MetadataInput {
  name: string;
  description: string;
  imageIpfsUri: string;
  attributes: NftAttributes;
}

interface PrepareInput {
  itemTitle: string;
  itemDescription: string | null;
  imageUrl: string | null;
  tagUid: string;
  scanCount: number;
  sellerUsername: string;
  verificationStatus: string;
}

export const uploadImageToIpfs = async (imageUrl: string, fileName: string): Promise<string> => {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

  const blob = await response.blob();
  const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });

  const result = await pinata.upload.file(file);
  return `ipfs://${result.IpfsHash}`;
};

export const uploadMetadataToIpfs = async (metadata: MetadataInput): Promise<string> => {
  const erc721Metadata = {
    name: metadata.name,
    description: metadata.description,
    image: metadata.imageIpfsUri,
    attributes: Object.entries(metadata.attributes).map(([trait_type, value]) => ({
      trait_type,
      value: typeof value === 'number' ? value : String(value),
    })),
  };

  const result = await pinata.upload.json(erc721Metadata);
  return `ipfs://${result.IpfsHash}`;
};

export const prepareNftMetadata = async (input: PrepareInput): Promise<{ metadataUri: string; metadataJson: Record<string, unknown> }> => {
  let imageIpfsUri = '';

  if (input.imageUrl) {
    const fileName = `auctionx-${input.tagUid}.jpg`;
    imageIpfsUri = await uploadImageToIpfs(input.imageUrl, fileName);
  }

  const attributes: NftAttributes = {
    tag_uid: input.tagUid,
    scan_count: input.scanCount,
    seller: input.sellerUsername,
    verification_status: input.verificationStatus,
    platform: 'AuctionX',
  };

  const name = `AuctionX: ${input.itemTitle}`;
  const description = input.itemDescription || `Authenticated item: ${input.itemTitle}`;

  const metadataUri = await uploadMetadataToIpfs({ name, description, imageIpfsUri, attributes });

  const metadataJson = {
    name,
    description,
    image: imageIpfsUri,
    attributes: Object.entries(attributes).map(([trait_type, value]) => ({ trait_type, value })),
  };

  return { metadataUri, metadataJson };
};
