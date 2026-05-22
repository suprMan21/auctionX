import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type {
  AdminAuctionRow,
  AdminAuctionsListData,
  AuctionStatus,
  BrandType,
} from '../types/admin';
import { brandLabel } from '../types/admin';

const AUCTION_STATUSES: ReadonlyArray<AuctionStatus> = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'CANCELLED',
  'SETTLED',
];

const SORT_OPTIONS: ReadonlyArray<{ value: NonNullable<Parameters<typeof adminApi.listAuctions>[0]>['sort']; label: string }> = [
  { value: 'end_time_asc', label: 'Ending soonest' },
  { value: 'end_time_desc', label: 'Ending latest' },
  { value: 'current_price_desc', label: 'Highest bid' },
  { value: 'created_at_desc', label: 'Newest first' },
];

const statusClass = (status: AuctionStatus): string => {
  switch (status) {
    case 'ACTIVE':
    case 'SETTLED':
      return 'bg-success-500/20 text-success-500';
    case 'ENDED':
      return 'bg-gray-500/20 text-gray-400';
    case 'CANCELLED':
      return 'bg-error-500/20 text-error-500';
    case 'DRAFT':
    case 'SCHEDULED':
    default:
      return 'bg-warning-500/20 text-warning-500';
  }
};

const StatusBadge = ({ status }: { status: AuctionStatus }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(status)}`}>
    {status}
  </span>
);

const formatRelativeTime = (iso: string): string => {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diffMs = ts - Date.now();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (minutes < 1) label = 'now';
  else if (minutes < 60) label = `${minutes}m`;
  else if (hours < 48) label = `${hours}h`;
  else label = `${days}d`;
  return diffMs >= 0 ? `in ${label}` : `${label} ago`;
};

const formatPrice = (cents: number | null | undefined, currency: string | null | undefined): string => {
  if (cents == null) return '—';
  const dollars = cents / 100;
  return `${currency ?? 'USD'} ${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const Pagination = ({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) => {
  if (pages <= 1) return null;
  const pageNumbers = Array.from({ length: Math.min(pages, 7) }, (_, i) => {
    if (pages <= 7) return i + 1;
    if (page <= 4) return i + 1;
    if (page >= pages - 3) return pages - 6 + i;
    return page - 3 + i;
  });
  return (
    <div className="flex items-center gap-2 justify-center pt-4">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ← Prev
      </button>
      {pageNumbers.map((p) => (
        <button
          key={p}
          onClick={() => onPage(p)}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            p === page
              ? 'bg-primary-500/20 text-primary-400 font-medium'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onPage(page + 1)}
        disabled={page === pages}
        className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next →
      </button>
    </div>
  );
};

export const AdminAuctionsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [data, setData] = useState<AdminAuctionsListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchInput = searchParams.get('search') ?? '';
  const sellerInput = searchParams.get('seller') ?? '';
  const brand = (searchParams.get('brand') as BrandType | null) ?? '';
  const sort = (searchParams.get('sort') as AuctionStatus | null) ?? 'end_time_asc';
  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const statusParam = searchParams.get('status') ?? '';
  const selectedStatuses = useMemo(
    () => (statusParam ? statusParam.split(',').filter(Boolean) : []) as AuctionStatus[],
    [statusParam],
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sellerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.listAuctions({
          page,
          limit: 25,
          status: selectedStatuses.length > 0 ? selectedStatuses : undefined,
          brand: brand || undefined,
          seller: sellerInput || undefined,
          search: searchInput || undefined,
          sort: (sort as Parameters<typeof adminApi.listAuctions>[0] extends infer P ? (P extends { sort?: infer S } ? S : never) : never) ?? undefined,
        });
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load auctions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [page, statusParam, brand, sellerInput, searchInput, sort, selectedStatuses]);

  const updateParam = (mutate: (next: URLSearchParams) => void) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      mutate(next);
      return next;
    });
  };

  const onSearchInput = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateParam((next) => {
        if (value) next.set('search', value);
        else next.delete('search');
        next.set('page', '1');
      });
    }, 300);
  };

  const onSellerInput = (value: string) => {
    if (sellerDebounceRef.current) clearTimeout(sellerDebounceRef.current);
    sellerDebounceRef.current = setTimeout(() => {
      updateParam((next) => {
        if (value) next.set('seller', value);
        else next.delete('seller');
        next.set('page', '1');
      });
    }, 300);
  };

  const toggleStatus = (s: AuctionStatus) => {
    updateParam((next) => {
      const current = new Set(selectedStatuses);
      if (current.has(s)) current.delete(s);
      else current.add(s);
      const list = Array.from(current);
      if (list.length === 0) next.delete('status');
      else next.set('status', list.join(','));
      next.set('page', '1');
    });
  };

  const setBrand = (b: string) => {
    updateParam((next) => {
      if (b) next.set('brand', b);
      else next.delete('brand');
      next.set('page', '1');
    });
  };

  const setSort = (s: string) => {
    updateParam((next) => {
      next.set('sort', s);
      next.set('page', '1');
    });
  };

  const setPage = (p: number) => {
    updateParam((next) => {
      next.set('page', String(p));
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Auctions</h1>
        {data && (
          <p className="text-gray-400 text-sm mt-1">{data.total.toLocaleString()} total auctions</p>
        )}
      </div>

      {/* Filters */}
      <div className="glass rounded-2xl p-4 space-y-3 border border-white/10">
        <div className="flex flex-col lg:flex-row gap-3">
          <input
            data-testid="auction-search"
            type="search"
            defaultValue={searchInput}
            onChange={(e) => onSearchInput(e.target.value)}
            placeholder="Search by listing title…"
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
                       border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          />
          <input
            data-testid="auction-seller-search"
            type="search"
            defaultValue={sellerInput}
            onChange={(e) => onSellerInput(e.target.value)}
            placeholder="Seller (name or UUID)…"
            className="lg:w-64 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
                       border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          />
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            className="lg:w-48 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white border border-transparent
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            <option value="">All brands</option>
            <option value="AUCTIONX">Authentic Materials</option>
            <option value="UNMENTIONABLES">Unmentionables</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="lg:w-56 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white border border-transparent
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {AUCTION_STATUSES.map((s) => {
            const active = selectedStatuses.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  active
                    ? 'bg-primary-500/30 text-primary-200 border-primary-400/50'
                    : 'bg-dark-700 text-gray-400 border-white/10 hover:text-white hover:bg-dark-700/70'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div data-testid="auctions-table" className="glass rounded-2xl overflow-hidden border border-white/10">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-6">
            <p className="text-error-500 text-sm">{error}</p>
          </div>
        ) : !data || data.results.length === 0 ? (
          <div className="p-6">
            <p className="text-gray-400 text-sm">No auctions match the current filters.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700 border-b border-white/10">
                  <tr>
                    {['', 'Title', 'Seller', 'Bid', 'Reserve', 'Status', 'Bids', 'Ends', 'Created', ''].map((h, i) => (
                      <th
                        key={`${h}-${i}`}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.results.map((row: AdminAuctionRow) => (
                    <tr
                      key={row.auction_id}
                      onClick={() => navigate(`/admin/auctions/${row.auction_id}`)}
                      className="bg-dark-800 hover:bg-dark-700 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        {row.thumbnail_url ? (
                          <img
                            src={row.thumbnail_url}
                            alt=""
                            className="w-12 h-12 object-cover rounded-lg border border-white/10"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-dark-700 border border-white/10" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className="text-white max-w-[260px] truncate inline-block align-middle"
                          title={row.title ?? ''}
                        >
                          {row.title ?? 'Untitled'}
                        </span>
                        {row.brand && (
                          <div className="text-xs text-gray-500 mt-0.5">{brandLabel(row.brand)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {row.seller_display_name ?? <span className="text-gray-500">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-white">
                        {formatPrice(row.current_price_cents, row.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {formatPrice(row.reserve_price_cents, row.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">{row.bid_count}</td>
                      <td
                        className="px-4 py-3 text-sm text-gray-300"
                        title={new Date(row.end_time).toLocaleString()}
                      >
                        {formatRelativeTime(row.end_time)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {new Date(row.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-primary-400 text-xs hover:text-primary-300">View →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-white/10">
              <Pagination page={data.page} pages={data.totalPages} onPage={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
