INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order) VALUES
('Sports Memorabilia', 'sports-memorabilia', NULL, 'AUCTIONX'::brand_type, false, 1),
('Collectibles', 'collectibles', NULL, 'AUCTIONX'::brand_type, false, 2),
('Celebrity Items', 'celebrity-items', NULL, 'AUCTIONX'::brand_type, false, 3),
('Creator Merchandise', 'creator-merchandise', NULL, 'UNMENTIONABLES'::brand_type, false, 4),
('Personal Items', 'personal-items', NULL, 'UNMENTIONABLES'::brand_type, true, 5)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Baseball', 'baseball', id, 'AUCTIONX'::brand_type, false, 1 FROM categories WHERE slug = 'sports-memorabilia'
UNION ALL
SELECT 'Basketball', 'basketball', id, 'AUCTIONX'::brand_type, false, 2 FROM categories WHERE slug = 'sports-memorabilia'
UNION ALL
SELECT 'Football', 'football', id, 'AUCTIONX'::brand_type, false, 3 FROM categories WHERE slug = 'sports-memorabilia'
UNION ALL
SELECT 'Hockey', 'hockey', id, 'AUCTIONX'::brand_type, false, 4 FROM categories WHERE slug = 'sports-memorabilia'
UNION ALL
SELECT 'Soccer', 'soccer', id, 'AUCTIONX'::brand_type, false, 5 FROM categories WHERE slug = 'sports-memorabilia'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Signed Jerseys', 'signed-jerseys', id, 'AUCTIONX'::brand_type, false, 1 FROM categories WHERE slug = 'baseball'
UNION ALL
SELECT 'Game-Used Bats', 'game-used-bats', id, 'AUCTIONX'::brand_type, false, 2 FROM categories WHERE slug = 'baseball'
UNION ALL
SELECT 'Trading Cards', 'baseball-cards', id, 'AUCTIONX'::brand_type, false, 3 FROM categories WHERE slug = 'baseball'
UNION ALL
SELECT 'Autographed Balls', 'autographed-balls', id, 'AUCTIONX'::brand_type, false, 4 FROM categories WHERE slug = 'baseball'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Signed Jerseys', 'basketball-jerseys', id, 'AUCTIONX'::brand_type, false, 1 FROM categories WHERE slug = 'basketball'
UNION ALL
SELECT 'Game-Used Shoes', 'game-used-shoes', id, 'AUCTIONX'::brand_type, false, 2 FROM categories WHERE slug = 'basketball'
UNION ALL
SELECT 'Trading Cards', 'basketball-cards', id, 'AUCTIONX'::brand_type, false, 3 FROM categories WHERE slug = 'basketball'
UNION ALL
SELECT 'Championship Items', 'championship-items', id, 'AUCTIONX'::brand_type, false, 4 FROM categories WHERE slug = 'basketball'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Trading Cards', 'trading-cards', id, 'AUCTIONX'::brand_type, false, 1 FROM categories WHERE slug = 'collectibles'
UNION ALL
SELECT 'Coins', 'coins', id, 'AUCTIONX'::brand_type, false, 2 FROM categories WHERE slug = 'collectibles'
UNION ALL
SELECT 'Stamps', 'stamps', id, 'AUCTIONX'::brand_type, false, 3 FROM categories WHERE slug = 'collectibles'
UNION ALL
SELECT 'Comics', 'comics', id, 'AUCTIONX'::brand_type, false, 4 FROM categories WHERE slug = 'collectibles'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Pokemon', 'pokemon-cards', id, 'AUCTIONX'::brand_type, false, 1 FROM categories WHERE slug = 'trading-cards'
UNION ALL
SELECT 'Magic: The Gathering', 'mtg-cards', id, 'AUCTIONX'::brand_type, false, 2 FROM categories WHERE slug = 'trading-cards'
UNION ALL
SELECT 'Yu-Gi-Oh!', 'yugioh-cards', id, 'AUCTIONX'::brand_type, false, 3 FROM categories WHERE slug = 'trading-cards'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Movie Props', 'movie-props', id, 'AUCTIONX'::brand_type, false, 1 FROM categories WHERE slug = 'celebrity-items'
UNION ALL
SELECT 'Autographs', 'celebrity-autographs', id, 'AUCTIONX'::brand_type, false, 2 FROM categories WHERE slug = 'celebrity-items'
UNION ALL
SELECT 'Personal Wardrobe', 'celebrity-wardrobe', id, 'AUCTIONX'::brand_type, false, 3 FROM categories WHERE slug = 'celebrity-items'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Apparel', 'creator-apparel', id, 'UNMENTIONABLES'::brand_type, false, 1 FROM categories WHERE slug = 'creator-merchandise'
UNION ALL
SELECT 'Accessories', 'creator-accessories', id, 'UNMENTIONABLES'::brand_type, false, 2 FROM categories WHERE slug = 'creator-merchandise'
UNION ALL
SELECT 'Custom Content', 'custom-content', id, 'UNMENTIONABLES'::brand_type, true, 3 FROM categories WHERE slug = 'creator-merchandise'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (name, slug, parent_id, brand_restriction, is_nsfw, sort_order)
SELECT 'Worn Items', 'worn-items', id, 'UNMENTIONABLES'::brand_type, true, 1 FROM categories WHERE slug = 'personal-items'
UNION ALL
SELECT 'Used Items', 'used-items', id, 'UNMENTIONABLES'::brand_type, true, 2 FROM categories WHERE slug = 'personal-items'
UNION ALL
SELECT 'Collectible Items', 'collectible-items', id, 'UNMENTIONABLES'::brand_type, false, 3 FROM categories WHERE slug = 'personal-items'
ON CONFLICT (slug) DO NOTHING;
