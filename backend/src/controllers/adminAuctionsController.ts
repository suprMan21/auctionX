import type { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import type { RequestWithId } from '../middleware/requestId';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const getServiceClient = () => createClient<Database>(supabaseUrl, supabaseServiceKey);

type AuctionStatus = Database['public']['Enums']['auction_status'];
type BrandType = Database['public']['Enums']['brand_type'];

const AUCTION_STATUSES: ReadonlyArray<AuctionStatus> = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED', 'SETTLED'];
const BRAND_VALUES: ReadonlyArray<BrandType> = ['AUCTIONX', 'UNMENTIONABLES'];

const isAuctionStatus = (v: string): v is AuctionStatus => (AUCTION_STATUSES as ReadonlyArray<string>).includes(v);
const isBrand = (v: string): v is BrandType => (BRAND_VALUES as ReadonlyArray<string>).includes(v);

type SortKey = 'end_time_asc' | 'end_time_desc' | 'current_price_desc' | 'created_at_desc';
const SORT_KEYS: ReadonlyArray<SortKey> = ['end_time_asc', 'end_time_desc', 'current_price_desc', 'created_at_desc'];
const isSortKey = (v: string): v is SortKey => (SORT_KEYS as ReadonlyArray<string>).includes(v);

const handleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof AppError) {
    return res.status(error.status).json({ success: false, error: error.message, code: error.code });
  }
  console.error(`[admin-auctions] ${fallback}:`, error);
  return res.status(500).json({ success: false, error: fallback });
};

/**
 * GET /api/v1/admin/auctions
 *
 * Lists auctions joined with their listing, seller, primary media thumbnail, and bid count.
 * Filters: status (multi via comma-separated), brand, category (id), seller (id OR display_name search),
 * search (ilike on listing title). Sort: end_time asc/desc, current_price_cents desc, created_at desc.
 *
 * Note on primary key: auction.id is used throughout this router (and the matching frontend page) because
 * actions (end/cancel/settle) operate on auctions. listing.id is 1:1 but we surface auctions consistently
 * to keep ids stable across the table → detail → action flow.
 */
export const listAuctions = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const supabase = getServiceClient();

    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? '25', 10) || 25, 1), 100);
    const offset = (page - 1) * limit;

    const statusRaw = (req.query.status as string | undefined)?.trim();
    const statuses = statusRaw
      ? statusRaw.split(',').map((s) => s.trim()).filter(isAuctionStatus)
      : [];

    const brandRaw = (req.query.brand as string | undefined)?.trim();
    const brand = brandRaw && isBrand(brandRaw) ? brandRaw : undefined;

    const categoryId = (req.query.category as string | undefined)?.trim() || undefined;
    const sellerQuery = (req.query.seller as string | undefined)?.trim() || undefined;
    const search = (req.query.search as string | undefined)?.trim() || undefined;
    const sortRaw = (req.query.sort as string | undefined)?.trim();
    const sort: SortKey = sortRaw && isSortKey(sortRaw) ? sortRaw : 'end_time_asc';

    // If the seller filter looks like a UUID, treat it as a direct id match.
    // Otherwise, resolve it to a set of seller_ids via display_name ilike search.
    let sellerIds: string[] | null = null;
    if (sellerQuery) {
      const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sellerQuery);
      if (looksLikeUuid) {
        sellerIds = [sellerQuery];
      } else {
        const { data: matchedUsers, error: userErr } = await supabase
          .from('users')
          .select('id')
          .ilike('display_name', `%${sellerQuery}%`)
          .limit(50);
        if (userErr) throw userErr;
        sellerIds = matchedUsers?.map((u) => u.id) ?? [];
        if (sellerIds.length === 0) {
          // No matching sellers → guaranteed empty result; short-circuit.
          return res.json({
            success: true,
            data: { results: [], total: 0, page, totalPages: 0 },
          });
        }
      }
    }

    // Build the query. Join through auctions for stable ids; pull listing + seller fields via FK rels.
    let query = supabase
      .from('auctions')
      .select(
        `
        id,
        status,
        current_price_cents,
        reserve_price_cents,
        starting_price_cents,
        minimum_increment_cents,
        start_time,
        end_time,
        currency,
        created_at,
        updated_at,
        seller_id,
        winner_id,
        listing:listings!inner (
          id,
          title,
          brand,
          category_id,
          status,
          is_nsfw,
          description,
          created_at
        ),
        seller:users!auctions_seller_id_fkey ( id, display_name, email )
        `,
        { count: 'exact' }
      );

    if (statuses.length > 0) {
      query = query.in('status', statuses);
    }
    if (sellerIds) {
      query = query.in('seller_id', sellerIds);
    }
    // Listing-side filters (PostgREST embedded resource filter syntax).
    if (brand) {
      query = query.eq('listing.brand', brand);
    }
    if (categoryId) {
      query = query.eq('listing.category_id', categoryId);
    }
    if (search) {
      query = query.ilike('listing.title', `%${search}%`);
    }

    switch (sort) {
      case 'end_time_desc':
        query = query.order('end_time', { ascending: false });
        break;
      case 'current_price_desc':
        query = query.order('current_price_cents', { ascending: false });
        break;
      case 'created_at_desc':
        query = query.order('created_at', { ascending: false });
        break;
      case 'end_time_asc':
      default:
        query = query.order('end_time', { ascending: true });
        break;
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const listingIds = rows
      .map((r) => (r.listing as unknown as { id: string } | null)?.id)
      .filter((id): id is string => typeof id === 'string');
    const auctionIds = rows.map((r) => r.id);

    // Fetch a primary thumbnail per listing (sort_order asc, first row) in one batch.
    const thumbnailByListing = new Map<string, string | null>();
    if (listingIds.length > 0) {
      const { data: media, error: mediaErr } = await supabase
        .from('listing_media')
        .select('listing_id, thumbnail_url, url, sort_order')
        .in('listing_id', listingIds)
        .order('sort_order', { ascending: true });
      if (mediaErr) throw mediaErr;
      for (const m of media ?? []) {
        if (!thumbnailByListing.has(m.listing_id)) {
          thumbnailByListing.set(m.listing_id, m.thumbnail_url ?? m.url ?? null);
        }
      }
    }

    // Bid counts per auction.
    const bidCountByAuction = new Map<string, number>();
    if (auctionIds.length > 0) {
      const { data: bidRows, error: bidErr } = await supabase
        .from('bids')
        .select('auction_id')
        .in('auction_id', auctionIds);
      if (bidErr) throw bidErr;
      for (const b of bidRows ?? []) {
        bidCountByAuction.set(b.auction_id, (bidCountByAuction.get(b.auction_id) ?? 0) + 1);
      }
    }

    const results = rows.map((row) => {
      const listing = row.listing as unknown as {
        id: string;
        title: string;
        brand: BrandType;
        category_id: string;
        status: Database['public']['Enums']['listing_status'];
        is_nsfw: boolean;
      } | null;
      const seller = row.seller as unknown as { id: string; display_name: string | null; email: string | null } | null;
      return {
        auction_id: row.id,
        listing_id: listing?.id ?? null,
        title: listing?.title ?? null,
        brand: listing?.brand ?? null,
        category_id: listing?.category_id ?? null,
        listing_status: listing?.status ?? null,
        is_nsfw: listing?.is_nsfw ?? false,
        status: row.status,
        current_price_cents: row.current_price_cents,
        reserve_price_cents: row.reserve_price_cents,
        currency: row.currency,
        start_time: row.start_time,
        end_time: row.end_time,
        created_at: row.created_at,
        seller_id: row.seller_id,
        seller_display_name: seller?.display_name ?? null,
        bid_count: bidCountByAuction.get(row.id) ?? 0,
        thumbnail_url: listing?.id ? thumbnailByListing.get(listing.id) ?? null : null,
      };
    });

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    logger.info('admin_list_auctions', { total, page, limit, filters: { statuses, brand, categoryId, sellerQuery, search, sort } });

    return res.json({
      success: true,
      data: { results, total, page, totalPages },
    });
  } catch (error) {
    return handleError(res, error, 'Failed to list auctions');
  }
};

/**
 * GET /api/v1/admin/auctions/:id
 * Returns full detail: listing, auction state, bid history, settlement summary, media.
 */
export const getAuctionDetail = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || !id) {
      throw new AppError('invalid_argument', 'auction id is required');
    }
    const supabase = getServiceClient();

    const { data: auction, error: auctionErr } = await supabase
      .from('auctions')
      .select(
        `
        *,
        listing:listings!inner (
          id, title, description, brand, category_id, condition, status,
          is_nsfw, is_featured, location_city, location_country, location_region,
          requires_age_verification, reserve_price_cents, created_at, updated_at
        ),
        seller:users!auctions_seller_id_fkey ( id, display_name, email ),
        high_bidder:users!auctions_high_bidder_id_fkey ( id, display_name ),
        winner:users!auctions_winner_id_fkey ( id, display_name )
        `
      )
      .eq('id', id)
      .single();

    if (auctionErr || !auction) {
      throw new AppError('not_found', 'Auction not found');
    }

    const listingId = (auction.listing as unknown as { id: string } | null)?.id;

    const [mediaRes, bidsRes, settlementRes] = await Promise.all([
      listingId
        ? supabase
            .from('listing_media')
            .select('id, type, url, thumbnail_url, sort_order, width, height')
            .eq('listing_id', listingId)
            .order('sort_order', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('bids')
        .select(`
          id, amount_cents, max_bid_cents, is_auto_bid, created_at, bidder_id,
          bidder:users!bids_bidder_id_fkey ( id, display_name )
        `)
        .eq('auction_id', id)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('settlements')
        .select('id, status, gross_amount_cents, net_amount_cents, platform_fee_cents, escrow_ends_at, escrow_released_at, delivery_confirmed_at, dispute_opened_at, settled_at, created_at')
        .eq('auction_id', id)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    if (mediaRes.error) throw mediaRes.error;
    if (bidsRes.error) throw bidsRes.error;
    if (settlementRes.error) throw settlementRes.error;

    logger.info('admin_get_auction_detail', { auctionId: id });

    return res.json({
      success: true,
      data: {
        auction,
        media: mediaRes.data ?? [],
        bids: bidsRes.data ?? [],
        settlement: settlementRes.data?.[0] ?? null,
      },
    });
  } catch (error) {
    return handleError(res, error, 'Failed to fetch auction detail');
  }
};

/**
 * POST /api/v1/admin/auctions/:id/end
 * Force-ends an ACTIVE auction. Sets status=ENDED, end_time=NOW()-1s so any downstream
 * "is past end_time" predicates immediately match. Rejects with 412 failed_precondition
 * if the auction is not in ACTIVE state.
 */
export const endAuction = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || !id) throw new AppError('invalid_argument', 'auction id is required');
    const supabase = getServiceClient();

    const { data: existing, error: getErr } = await supabase
      .from('auctions')
      .select('id, status')
      .eq('id', id)
      .single();
    if (getErr || !existing) throw new AppError('not_found', 'Auction not found');
    if (existing.status !== 'ACTIVE') {
      throw new AppError('failed_precondition', `Cannot end auction in status ${existing.status}`);
    }

    const endTime = new Date(Date.now() - 1000).toISOString();
    const { data: updated, error: updErr } = await supabase
      .from('auctions')
      .update({ status: 'ENDED', end_time: endTime, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status, end_time, updated_at')
      .single();
    if (updErr || !updated) throw new AppError('internal', 'Failed to end auction');

    logger.info('admin_end_auction', { auctionId: id });
    return res.json({ success: true, data: updated });
  } catch (error) {
    return handleError(res, error, 'Failed to end auction');
  }
};

/**
 * POST /api/v1/admin/auctions/:id/restart
 *
 * Hard-restart an ENDED or CANCELLED auction (no settlement allowed). Wipes the bid history,
 * resets current_price to starting_price, clears high_bidder + winner fields, sets status=ACTIVE
 * with a new end_time = now() + durationHours, and re-activates the listing if it was cancelled.
 *
 * Body: { reason: string, durationHours: number }
 *   durationHours: bounded to 1..720 (30 days max). Required.
 */
export const restartAuction = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || !id) throw new AppError('invalid_argument', 'auction id is required');

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) throw new AppError('invalid_argument', 'reason is required');

    const durationHours = Number(req.body?.durationHours);
    if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 720) {
      throw new AppError('invalid_argument', 'durationHours must be a number between 1 and 720');
    }

    const supabase = getServiceClient();

    const { data: existing, error: getErr } = await supabase
      .from('auctions')
      .select('id, status, listing_id, starting_price_cents')
      .eq('id', id)
      .single();
    if (getErr || !existing) throw new AppError('not_found', 'Auction not found');
    if (existing.status !== 'ENDED' && existing.status !== 'CANCELLED') {
      throw new AppError('failed_precondition', `Cannot restart auction in status ${existing.status}`);
    }

    const { data: settlement, error: settleErr } = await supabase
      .from('settlements')
      .select('id')
      .eq('auction_id', id)
      .limit(1);
    if (settleErr) throw settleErr;
    if ((settlement?.length ?? 0) > 0) {
      throw new AppError('failed_precondition', 'Cannot restart an auction with an existing settlement');
    }

    const now = new Date();
    const newEndTime = new Date(now.getTime() + durationHours * 3_600_000);
    const nowIso = now.toISOString();

    // Step 1: reset auction. Clearing winning_bid_id frees the FK before we delete bids.
    const { data: auctionUpd, error: auctionUpdErr } = await supabase
      .from('auctions')
      .update({
        status: 'ACTIVE',
        start_time: nowIso,
        end_time: newEndTime.toISOString(),
        current_price_cents: existing.starting_price_cents,
        high_bidder_id: null,
        high_bidder_max_cents: null,
        winner_id: null,
        winning_bid_id: null,
        second_highest_max_cents: null,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('id, status, start_time, end_time, current_price_cents, updated_at')
      .single();
    if (auctionUpdErr || !auctionUpd) throw new AppError('internal', 'Failed to reset auction row');

    // Step 2: wipe bids for this auction.
    const { error: bidsDelErr } = await supabase
      .from('bids')
      .delete()
      .eq('auction_id', id);
    if (bidsDelErr) {
      logger.error('admin_restart_auction_bids_delete_failed', { auctionId: id, err: String(bidsDelErr) });
      throw new AppError('internal', 'Auction reset, but failed to clear old bids — manual cleanup needed');
    }

    // Step 3: re-activate the listing (no-op if already ACTIVE).
    const { data: listingUpd, error: listingUpdErr } = await supabase
      .from('listings')
      .update({ status: 'ACTIVE', updated_at: nowIso })
      .eq('id', existing.listing_id)
      .select('id, status')
      .single();
    if (listingUpdErr || !listingUpd) {
      logger.error('admin_restart_auction_listing_update_failed', { auctionId: id, listingId: existing.listing_id, err: String(listingUpdErr) });
      throw new AppError('internal', 'Auction restarted, but failed to re-activate listing — manual cleanup needed');
    }

    logger.info('admin_restart_auction', { auctionId: id, listingId: existing.listing_id, durationHours, reason });

    return res.json({
      success: true,
      data: { auction: auctionUpd, listing: listingUpd, reason, durationHours },
    });
  } catch (error) {
    return handleError(res, error, 'Failed to restart auction');
  }
};

/**
 * POST /api/v1/admin/auctions/:id/cancel
 * Cancels an auction + its listing. Body: { reason: string }.
 *
 * Preconditions:
 *  - Auction status MUST NOT be SETTLED.
 *  - There MUST NOT be an existing settlement row for the auction (signals money has moved).
 *
 * Updates run sequentially (auction first, listing second). If the listing update fails, we attempt
 * to revert the auction row back to its prior status so the two stay consistent.
 */
export const cancelAuction = async (req: Request & RequestWithId, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });
  try {
    const id = req.params.id;
    if (typeof id !== 'string' || !id) throw new AppError('invalid_argument', 'auction id is required');

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) throw new AppError('invalid_argument', 'reason is required');

    const supabase = getServiceClient();

    const { data: existing, error: getErr } = await supabase
      .from('auctions')
      .select('id, status, listing_id')
      .eq('id', id)
      .single();
    if (getErr || !existing) throw new AppError('not_found', 'Auction not found');
    if (existing.status === 'SETTLED') {
      throw new AppError('failed_precondition', 'Cannot cancel a SETTLED auction');
    }
    if (existing.status === 'CANCELLED') {
      throw new AppError('failed_precondition', 'Auction is already CANCELLED');
    }

    const { data: settlement, error: settleErr } = await supabase
      .from('settlements')
      .select('id')
      .eq('auction_id', id)
      .limit(1);
    if (settleErr) throw settleErr;
    if ((settlement?.length ?? 0) > 0) {
      throw new AppError('failed_precondition', 'Cannot cancel an auction with an existing settlement');
    }

    const priorStatus = existing.status;
    const now = new Date().toISOString();

    const { data: auctionUpd, error: auctionUpdErr } = await supabase
      .from('auctions')
      .update({ status: 'CANCELLED', updated_at: now })
      .eq('id', id)
      .select('id, status, updated_at')
      .single();
    if (auctionUpdErr || !auctionUpd) throw new AppError('internal', 'Failed to cancel auction row');

    const { data: listingUpd, error: listingUpdErr } = await supabase
      .from('listings')
      .update({ status: 'CANCELLED', updated_at: now })
      .eq('id', existing.listing_id)
      .select('id, status')
      .single();
    if (listingUpdErr || !listingUpd) {
      // Best-effort rollback: restore the auction row to its prior status.
      const { error: rollbackErr } = await supabase
        .from('auctions')
        .update({ status: priorStatus, updated_at: now })
        .eq('id', id);
      if (rollbackErr) {
        logger.error('admin_cancel_auction_rollback_failed', { auctionId: id, listingId: existing.listing_id, err: String(rollbackErr) });
      }
      throw new AppError('internal', 'Failed to cancel listing; auction rolled back');
    }

    logger.info('admin_cancel_auction', { auctionId: id, listingId: existing.listing_id, reason });

    return res.json({
      success: true,
      data: { auction: auctionUpd, listing: listingUpd, reason },
    });
  } catch (error) {
    return handleError(res, error, 'Failed to cancel auction');
  }
};
