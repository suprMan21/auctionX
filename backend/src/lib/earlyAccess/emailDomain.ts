import { promises as dns } from 'dns';
import { DISPOSABLE_DOMAINS } from './disposableDomains';

export type DomainVerdict = 'ok' | 'disposable' | 'no_mail';

type Resolver = {
  resolveMx: (domain: string) => Promise<unknown[]>;
  resolve4: (domain: string) => Promise<unknown[]>;
  resolve6: (domain: string) => Promise<unknown[]>;
};

const DNS_TIMEOUT_MS = 3000;

const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('dns_timeout')), DNS_TIMEOUT_MS))]);

/** DNS says the name has no such record (as opposed to a lookup that failed). */
const isNoRecord = (err: unknown): boolean => {
  const code = (err as { code?: string })?.code;
  return code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN';
};

/** Domains match their parents too: `mail.mailinator.com` is disposable. */
export const isDisposable = (domain: string): boolean => {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
};

/**
 * Can this domain receive mail? Rejects throwaway domains and domains with no MX and
 * no address record (RFC 5321 falls back to A/AAAA when there is no MX).
 *
 * Fails open: if DNS itself is slow or broken we accept the address rather than lose
 * a real person. Postmark's bounce handling is the backstop.
 */
export const checkEmailDomain = async (email: string, resolver: Resolver = dns): Promise<DomainVerdict> => {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (isDisposable(domain)) return 'disposable';

  const lookup = async (fn: (d: string) => Promise<unknown[]>): Promise<'yes' | 'no' | 'unknown'> => {
    try {
      const records = await withTimeout(fn(domain));
      return records.length > 0 ? 'yes' : 'no';
    } catch (err) {
      return isNoRecord(err) ? 'no' : 'unknown';
    }
  };

  const mx = await lookup((d) => resolver.resolveMx(d));
  if (mx !== 'no') return 'ok';
  const [a, aaaa] = await Promise.all([lookup((d) => resolver.resolve4(d)), lookup((d) => resolver.resolve6(d))]);
  return a === 'no' && aaaa === 'no' ? 'no_mail' : 'ok';
};
