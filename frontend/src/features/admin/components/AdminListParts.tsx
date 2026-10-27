/**
 * The pieces every admin list shares (UX-2): one paging style, one filter
 * style, one search box, and one way to show loading / error / empty.
 */

import { useId, useState, type ReactNode } from 'react';

const FOCUS = 'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800';

/** Previous / Next with "Page x of y". Hidden when there is one page. */
export const AdminPagination = ({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) => {
  if (pages <= 1) return null;
  const btn = `min-h-[44px] px-4 rounded-xl text-sm bg-dark-700 text-gray-200 hover:bg-dark-600
    disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={btn}>Previous</button>
      <span className="text-gray-400">Page {page} of {pages}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} className={btn}>Next</button>
    </nav>
  );
};

export interface FilterOption<V extends string> {
  label: string;
  value: V;
}

/** A row of toggle buttons; exactly one is pressed. */
export const FilterPills = <V extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: ReadonlyArray<FilterOption<V>>;
  value: V;
  onChange: (v: V) => void;
}) => (
  <div className="flex gap-2 flex-wrap" role="group" aria-label={label}>
    {options.map((opt) => (
      <button
        key={opt.value || 'all'}
        type="button"
        aria-pressed={value === opt.value}
        onClick={() => onChange(opt.value)}
        className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${FOCUS}
          ${value === opt.value
            ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30'
            : 'bg-dark-700 text-gray-300 hover:text-white hover:bg-dark-600 border border-transparent'}`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

/**
 * Search that runs on Enter or the Search button, never while typing. The
 * term stays in page state, not the URL: it is often an email, and the
 * address bar would keep it in browser history. Every search is audited by
 * the server, so a search per keystroke would flood the audit log.
 */
export const AdminSearchBox = ({
  label, placeholder, onSearch, active, validate, type = 'search', note = 'Searches are recorded in the audit log.',
}: {
  label: string;
  placeholder: string;
  onSearch: (term: string) => void;
  /** The search currently applied ('' for none); shows a Clear button. */
  active: string;
  /** Return an error message, or null when the term may be sent. */
  validate?: (term: string) => string | null;
  type?: 'search' | 'email';
  note?: string;
}) => {
  const [draft, setDraft] = useState(active);
  const inputId = useId();
  const noteId = useId();
  const term = draft.trim();
  const problem = term && validate ? validate(term) : null;
  return (
    <form
      role="search"
      aria-label="Search this list"
      className="flex flex-wrap items-start gap-2 w-full sm:w-auto sm:ml-auto"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onSearch(term);
      }}
    >
      {/* Phone (UX-3): the box takes the whole row and the buttons go under it, so nothing runs off a 375px screen. */}
      <div className="basis-full min-w-0 sm:basis-auto sm:flex-none">
        <label htmlFor={inputId} className="sr-only">{label}</label>
        <input
          id={inputId}
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-invalid={Boolean(problem)}
          aria-describedby={noteId}
          autoComplete="off"
          className={`w-full sm:w-72 min-h-[44px] px-3 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
            border border-transparent ${FOCUS}`}
        />
        <p id={noteId} className={`text-xs mt-1 ${problem ? 'text-red-400' : 'text-gray-400'}`}>{problem ?? note}</p>
      </div>
      <button
        type="submit"
        disabled={Boolean(problem)}
        className={`min-h-[44px] px-4 rounded-xl text-sm bg-dark-700 text-gray-200 hover:bg-dark-600 disabled:opacity-50 ${FOCUS}`}
      >
        Search
      </button>
      {active && (
        <button
          type="button"
          onClick={() => { setDraft(''); onSearch(''); }}
          className={`min-h-[44px] px-4 rounded-xl text-sm bg-dark-700 text-gray-200 hover:bg-dark-600 ${FOCUS}`}
        >
          Clear
        </button>
      )}
    </form>
  );
};

/** Loading spinner, error, or empty message; renders children once there are rows. */
export const ListState = ({
  loading, error, empty, emptyText, what, children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  /** e.g. "accounts", for the loading label. */
  what: string;
  children: ReactNode;
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label={`Loading ${what}`}>
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="glass rounded-2xl p-6 border border-red-500/30">
        <p role="alert" className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="glass rounded-2xl p-6">
        <p className="text-gray-400 text-sm">{emptyText}</p>
      </div>
    );
  }
  return <>{children}</>;
};
