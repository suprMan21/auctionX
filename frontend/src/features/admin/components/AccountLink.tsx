/**
 * An account shown by its email, linking to its account page for staff who
 * may view accounts. Falls back to a short ID when there is no email, and to
 * plain text when the admin cannot open account pages. Never truncated: the
 * full email is always readable (wraps at any character, full text in title).
 */

import { Link } from 'react-router-dom';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { NONE, shortId } from '../lib/display';

interface AccountLinkProps {
  id: string | null | undefined;
  email?: string | null;
  className?: string;
}

export const AccountLink = ({ id, email, className = '' }: AccountLinkProps) => {
  const access = useAdminRole();
  if (!id && !email) return <span className={className}>{NONE}</span>;
  const text = email ?? `Account ${shortId(id ?? null)}`;
  const classes = `break-all ${className}`;
  if (!id || !hasPermission(access, PERMISSIONS.viewUsers)) {
    return <span className={classes} title={email ?? id ?? undefined}>{text}</span>;
  }
  return (
    <Link
      to={`/admin/users/${id}`}
      title={email ? `${email} (open account)` : 'Open account'}
      className={`${classes} text-primary-300 hover:text-primary-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded`}
    >
      {text}
    </Link>
  );
};
