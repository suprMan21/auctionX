/**
 * Admin Users list page with search, status filter, and pagination.
 * Search is debounced 300ms and synced with URL query params.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AdminUser, UsersResponse } from '../types/admin';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Tier badge for seller tiers. */
const TierBadge = ({ tier }: { tier: string }) => {
  const colorMap: Record<string, string> = {
    TIER_1: 'bg-gray-500/20 text-gray-400',
    TIER_2: 'bg-primary-500/20 text-primary-400',
    TIER_3: 'bg-accent-500/20 text-accent-400',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[tier] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {tier}
    </span>
  );
};

/** Status badge reflecting suspension/ban state. */
const StatusBadge = ({ user }: { user: AdminUser }) => {
  if (user.is_banned) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-error-500/20 text-error-500">
        Banned
      </span>
    );
  }
  if (user.is_suspended) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-warning-500/20 text-warning-500">
        Suspended
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-success-500/20 text-success-500">
      Active
    </span>
  );
};

/** Pagination control row. */
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

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AdminUsersPage — searchable, filterable, paginated user list.
 */
export const AdminUsersPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [result, setResult] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchInput = searchParams.get('search') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const page = parseInt(searchParams.get('page') ?? '1', 10);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUsers = async (search: string, status: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listUsers({ search: search || undefined, status: status || undefined, page: p });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(searchInput, statusFilter, page);
  }, [searchInput, statusFilter, page]);

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('search', value); else next.delete('search');
        next.set('page', '1');
        return next;
      });
    }, 300);
  };

  const handleStatusChange = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('status', value); else next.delete('status');
      next.set('page', '1');
      return next;
    });
  };

  const handlePage = (p: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Users</h1>
        {result && (
          <p className="text-gray-400 text-sm mt-1">{result.pagination.total.toLocaleString()} total users</p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          data-testid="user-search"
          type="search"
          defaultValue={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by email or name…"
          className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
                     border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        />
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white border border-transparent
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="banned">Banned</option>
        </select>
      </div>

      {/* Table */}
      <div data-testid="users-table" className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-6">
            <p className="text-error-400 text-sm">{error}</p>
          </div>
        ) : !result || result.users.length === 0 ? (
          <div className="p-6">
            <p className="text-gray-400 text-sm">No users found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700 border-b border-white/10">
                  <tr>
                    {['Email', 'Display Name', 'Tier', 'Status', 'Created', ''].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {result.users.map((user) => (
                    <tr
                      key={user.id}
                      onClick={() => navigate(`/admin/users/${user.id}`)}
                      className="bg-dark-800 hover:bg-dark-700 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-white max-w-[200px] truncate">{user.email}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{user.display_name ?? '—'}</td>
                      <td className="px-4 py-3"><TierBadge tier={user.seller_tier} /></td>
                      <td className="px-4 py-3"><StatusBadge user={user} /></td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {new Date(user.created_at).toLocaleDateString()}
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
              <Pagination page={result.pagination.page} pages={result.pagination.pages} onPage={handlePage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
