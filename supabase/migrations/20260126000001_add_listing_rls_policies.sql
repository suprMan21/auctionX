ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active listings" ON listings;
DROP POLICY IF EXISTS "Sellers can view own drafts" ON listings;
DROP POLICY IF EXISTS "Sellers can create listings" ON listings;
DROP POLICY IF EXISTS "Sellers can update own listings" ON listings;
DROP POLICY IF EXISTS "Sellers can delete own listings" ON listings;
DROP POLICY IF EXISTS "Anyone can view listing media" ON listing_media;
DROP POLICY IF EXISTS "Sellers can manage own listing media" ON listing_media;

CREATE POLICY "Anyone can view active listings"
  ON listings FOR SELECT
  USING (status IN ('ACTIVE', 'SOLD'));

CREATE POLICY "Sellers can view own drafts"
  ON listings FOR SELECT
  USING (auth.uid() = seller_id);

CREATE POLICY "Sellers can create listings"
  ON listings FOR INSERT
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Sellers can update own listings"
  ON listings FOR UPDATE
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Sellers can delete own listings"
  ON listings FOR DELETE
  USING (auth.uid() = seller_id);

CREATE POLICY "Anyone can view listing media"
  ON listing_media FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = listing_media.listing_id
      AND (listings.status IN ('ACTIVE', 'SOLD') OR listings.seller_id = auth.uid())
    )
  );

CREATE POLICY "Sellers can manage own listing media"
  ON listing_media FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = listing_media.listing_id
      AND listings.seller_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = listing_media.listing_id
      AND listings.seller_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_listings_seller_id ON listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_category_id ON listings(category_id);
CREATE INDEX IF NOT EXISTS idx_listing_media_listing_id ON listing_media(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_media_sort_order ON listing_media(listing_id, sort_order);
