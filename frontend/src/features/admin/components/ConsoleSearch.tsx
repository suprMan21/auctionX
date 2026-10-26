/**
 * One search box for the whole console: an email, display name, account ID,
 * token name or serial number. Searches accounts and tokens at once (only the
 * ones this admin may see). One match opens it straight away; otherwise the
 * matches are listed under the box. Runs only when submitted: every search is
 * written to the audit log by the server. The term is never put in the URL.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi, type AdminTag } from '../api/adminApi';
import type { AccountSearch } from '../api/accountSchemas';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { errorMessage } from '../lib/display';
import { lifecycleLabel } from '../lib/labels';

const LIMIT = 5;
/** The token search accepts only these characters (backend searchTermSchema). */
const TOKEN_TERM = /^[A-Za-z0-9@._+'-]+$/;

type Account = AccountSearch['accounts'][number];
interface Results {
  term: string;
  accounts: Account[];
  accountTotal: number;
  tokens: AdminTag[];
  tokenTotal: number;
  failed: boolean;
}

const tokenName = (t: AdminTag) => t.chipName ?? (t.serialSuffix ? `Token …${t.serialSuffix}` : `Token …${t.uidSuffix}`);

export const ConsoleSearch = () => {
  const access = useAdminRole();
  const navigate = useNavigate();
  const canAccounts = hasPermission(access, PERMISSIONS.viewUsers);
  const canTokens = hasPermission(access, PERMISSIONS.manageNfc);
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the result list on Escape or a click outside it.
  useEffect(() => {
    if (!results) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setResults(null); };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setResults(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [results]);

  if (!canAccounts && !canTokens) return null;

  const placeholder = canAccounts && canTokens
    ? 'Search accounts and tokens: email, name or serial number'
    : canAccounts ? 'Search accounts: email, name or account ID' : 'Search tokens: owner email, token name or serial number';

  const open = (to: string) => {
    setResults(null);
    setTerm('');
    navigate(to);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    // A display name with a space ("Jane Doe") can only match an account: the
    // token search would refuse it, so it is not sent.
    const searchTokens = canTokens && TOKEN_TERM.test(q);
    if (!canAccounts && !searchTokens) {
      setBusy(false);
      setError('Token search takes an owner email, token name or serial number, without spaces.');
      return;
    }
    const [acc, tok] = await Promise.allSettled([
      canAccounts ? adminApi.searchAccounts({ q, limit: LIMIT }) : Promise.resolve(null),
      searchTokens ? adminApi.listTags({ q, limit: LIMIT }) : Promise.resolve(null),
    ]);
    setBusy(false);
    const accounts = acc.status === 'fulfilled' && acc.value ? acc.value.accounts : [];
    const accountTotal = acc.status === 'fulfilled' && acc.value ? acc.value.pagination.total : 0;
    const tokens = tok.status === 'fulfilled' && tok.value ? tok.value.data.tags : [];
    const tokenTotal = tok.status === 'fulfilled' && tok.value ? tok.value.data.pagination.total : 0;
    const failed = acc.status === 'rejected' || tok.status === 'rejected';
    if (acc.status === 'rejected' && tok.status === 'rejected') {
      setError(errorMessage(acc.reason, 'The search could not be run. Try again.'));
      return;
    }
    // Exactly one match and nothing failed: go straight to it.
    if (!failed && accountTotal + tokenTotal === 1) {
      open(accounts.length ? `/admin/users/${accounts[0].id}` : `/admin/tags/${tokens[0].id}`);
      return;
    }
    setResults({ term: q, accounts, accountTotal, tokens, tokenTotal, failed });
  };

  const itemClass = 'block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-200 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  return (
    <div ref={wrapRef} className="relative w-full max-w-xl">
      <form onSubmit={submit} role="search" className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">Search the console</label>
        <input
          id={inputId}
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          aria-controls={results ? panelId : undefined}
          className="min-w-0 flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-400 border border-white/10 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          disabled={busy || term.trim().length < 2}
          className="min-h-[44px] px-4 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      <p className="sr-only" aria-live="polite">
        {results ? `${results.accountTotal} accounts and ${results.tokenTotal} tokens match.` : ''}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-error-500">{error}</p>}

      {results && (
        <div id={panelId} className="absolute z-30 mt-2 w-full glass rounded-2xl border border-white/10 p-3 space-y-3 max-h-[70vh] overflow-y-auto">
          {results.accountTotal + results.tokenTotal === 0 && !results.failed && (
            <p className="text-sm text-gray-400 px-3 py-2">Nothing matches &ldquo;{results.term}&rdquo;. Check the spelling or try part of the email.</p>
          )}
          {results.failed && (
            <p className="text-sm text-warning-500 px-3">Part of the search could not be run, so some matches may be missing.</p>
          )}
          {results.accounts.length > 0 && (
            <section aria-label="Matching accounts">
              <h2 className="px-3 text-xs uppercase tracking-wider text-gray-400">Accounts</h2>
              <ul>
                {results.accounts.map((a) => (
                  <li key={a.id}>
                    <Link to={`/admin/users/${a.id}`} onClick={() => setResults(null)} className={itemClass}>
                      <span className="break-all">{a.email ?? a.id}</span>
                      {a.display_name && <span className="text-gray-400"> · {a.display_name}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
              {results.accountTotal > results.accounts.length && (
                <p className="px-3 text-xs text-gray-400">
                  Showing {results.accounts.length} of {results.accountTotal}. Type more of the email to narrow it down.
                </p>
              )}
            </section>
          )}
          {results.tokens.length > 0 && (
            <section aria-label="Matching tokens">
              <h2 className="px-3 text-xs uppercase tracking-wider text-gray-400">Tokens</h2>
              <ul>
                {results.tokens.map((t) => (
                  <li key={t.id}>
                    <Link to={`/admin/tags/${t.id}`} onClick={() => setResults(null)} className={itemClass}>
                      {tokenName(t)}
                      <span className="text-gray-400"> · {lifecycleLabel(t.lifecycleStatus)}</span>
                      {t.ownerEmail && <span className="text-gray-400 break-all"> · {t.ownerEmail}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
              {results.tokenTotal > results.tokens.length && (
                <p className="px-3 text-xs text-gray-400">
                  Showing {results.tokens.length} of {results.tokenTotal}. Type more of the name or email to narrow it down.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
};
