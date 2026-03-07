// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AuctionXNFT is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId = 1;

    event NFTMinted(address indexed to, uint256 indexed tokenId, string tokenURI);

    constructor() ERC721("AuctionX NFT", "AXNFT") Ownable(msg.sender) {}

    function mint(address to, string memory uri) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit NFTMinted(to, tokenId, uri);
        return tokenId;
    }
}
