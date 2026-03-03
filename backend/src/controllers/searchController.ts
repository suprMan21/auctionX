/**
 * searchController — Full-text search and saved searches
 *
 * Routes:
 *   GET  /api/v1/search             — public listing search (full-text + filters)
 *   POST /api/v1/search/saved       — create a saved search (auth required)
 *   GET  /api/v1/search/saved       — list user's saved searches (auth required)
 *   DELETE /api/v1/search/saved/:id — delete a saved search (auth required)
 *
 * Queries:
 *   - listings joined with auctions (inner), listing_media, item_verifications, categories (inner)
 *   - saved_searches filtered by user_id (service client bypasses RLS, so filter manually)
 *
 * Auth:
 *   - searchListings: public (no token required)
 *   - saved search handlers: requireAuth middleware applied in route file
 *
 * Notes:
 *   - verifiedOnly filter switches item_verifications join from outer to inner dynamically
 *   - DB-level sorting via referencedTable option (requires Supabase PostgREST >=11)
 *   - AuctionStatus in SQL is ACTIVE (not RUNNING — see locked Zod schema divergence)
 */
import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';

interface SearchRequest extends Request, RequestWithId {}
interface AuthSearchRequest extends Request, RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

// ──────────────────────────────────────────────────────────────────────────────
// Public: search listings
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/search
 *
 * Query params:
 *   q           — full-text search term (websearch syntax)
 *   category    — category slug to filter by
 *   minPrice    — minimum current_price_cents (integer)
 *   maxPrice    — maximum current_price_cents (integer)
 *   condition   — listing condition string
 *   verifiedOnly — 'true' to require item_verifications inner join
 *   sort        — 'relevance' | 'ending_soonest' | 'price_asc' | 'price_desc' | 'newest'
 *   page        — page number (1-indexed, default 1)
 *   limit       — results per page (default 24, max 48)
 */
export const searchListings = async (req: SearchRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const {
      q,
      category,
      minPrice,
      maxPrice,
      condition,
      verifiedOnly,
      sort = 'relevance',
      page: pageParam = '1',
      limit: limitParam = String(DEFAULT_LIMIT),
    } = req.query as Record<string, string | undefined>;

    const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitParam || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    const from = (page - 1) * limit;

    const supabase = getServiceClient();

    // Build select string — switch item_verifications join type based on verifiedOnly
    const verifiedJoin = verifiedOnly === 'true'
      ? 'item_verifications!inner(id, status, token_name)'
      : 'item_verifications(id, status, token_name)';

    const selectStr = `
      id, title, condition, status, created_at,
      auctions!inner(id, current_price_cents, end_time, status),
      listing_media(url, type, sort_order),
      ${verifiedJoin},
      categories!inner(id, name, slug)
    `;

    let query = supabase
      .from('listings')
      .select(selectStr, { count: 'exact' })
      .eq('status', 'ACTIVE')
      // SQL enum value is ACTIVE (Zod locked schemas use RUNNING — they've diverged)
      .eq('auctions.status', 'ACTIVE');

    // Full-text search — websearch syntax supports +/- operators, quoted phrases, etc.
    if (q && q.trim()) {
      // search_vector is not in generated types yet; use type assertion
      query = query.textSearch('search_vector' as never, q.trim(), { type: 'websearch', config: 'english' });
    }

    // Category filter via categories.slug (inner join already in select)
    if (category && category.trim()) {
      query = query.eq('categories.slug', category.trim());
    }

    // Price filters on auction's current_price_cents
    if (minPrice && !isNaN(parseInt(minPrice, 10))) {
      query = query.gte('auctions.current_price_cents', parseInt(minPrice, 10));
    }
    if (maxPrice && !isNaN(parseInt(maxPrice, 10))) {
      query = query.lte('auctions.current_price_cents', parseInt(maxPrice, 10));
    }

    // Condition filter
    if (condition && condition.trim()) {
      query = query.eq('condition', condition.trim());
    }

    // DB-level sorting
    switch (sort) {
      case 'ending_soonest':
        query = query.order('end_time', { referencedTable: 'auctions', ascending: true });
        break;
      case 'price_asc':
        query = query.order('current_price_cents', { referencedTable: 'auctions', ascending: true });
        break;
      case 'price_desc':
        query = query.order('current_price_cents', { referencedTable: 'auctions', ascending: false });
        break;
      case 'newest':
        query = query.order('created_at', { ascending: false });
        break;
      case 'relevance':
      default:
        // textSearch orders by ts_rank naturally; no explicit order needed
        break;
    }

    // Pagination
    query = query.range(from, from + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('search_query_failed', { error: error.message });
      throw new AppError('internal', 'Search failed');
    }

    const total = count ?? 0;
    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      data: {
        results: data ?? [],
        total,
        page,
        totalPages,
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    logger.error('search_unexpected_error', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Authenticated: saved searches
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/search/saved
 * Body: { name, query, filters, notifyNewResults }
 */
export const createSavedSearch = async (req: AuthSearchRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { name, query, filters, notifyNewResults } = req.body as {
      name?: string;
      query?: string;
      filters?: Record<string, unknown>;
      notifyNewResults?: boolean;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError('invalid_argument', 'name is required');
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: name.trim(),
        query: query ?? '',
        filters: filters ?? {},
        notify_new_results: notifyNewResults ?? false,
      })
      .select()
      .single();

    if (error) {
      logger.error('create_saved_search_failed', { userId, error: error.message });
      throw new AppError('internal', 'Failed to create saved search');
    }

    return res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/search/saved
 * Returns all saved searches belonging to the authenticated user.
 * Service client bypasses RLS, so we filter by user_id manually.
 */
export const getSavedSearches = async (req: AuthSearchRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('saved_searches')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('get_saved_searches_failed', { userId, error: error.message });
      throw new AppError('internal', 'Failed to fetch saved searches');
    }

    return res.json({ success: true, data: data ?? [] });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * DELETE /api/v1/search/saved/:id
 * Deletes a saved search after verifying ownership.
 */
export const deleteSavedSearch = async (req: AuthSearchRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id } = req.params;
    if (!id) throw new AppError('invalid_argument', 'id is required');

    const supabase = getServiceClient();

    // Verify ownership before delete
    const { data: existing, error: fetchError } = await supabase
      .from('saved_searches')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new AppError('not_found', 'Saved search not found');
    }
    if (existing.user_id !== userId) {
      throw new AppError('permission_denied', 'You do not own this saved search');
    }

    const { error: deleteError } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error('delete_saved_search_failed', { userId, id, error: deleteError.message });
      throw new AppError('internal', 'Failed to delete saved search');
    }

    return res.json({ success: true, data: null });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
