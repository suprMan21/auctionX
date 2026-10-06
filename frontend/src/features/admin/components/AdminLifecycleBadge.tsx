/**
 * Raw lifecycle status for admin screens (S-ADMIN1). Admins need the exact
 * enum value, not the collector-facing copy TokenStatusBadge shows. An icon
 * carries the meaning too, so status is never conveyed by colour alone.
 */

const STYLE: Record<string, { cls: string; icon: string }> = {
  ACTIVE: { cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', icon: '✓' },
  ENROLLED: { cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30', icon: '•' },
  SUSPENDED: { cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30', icon: '!' },
  RETIRED: { cls: 'bg-red-500/15 text-red-300 border-red-400/30', icon: '✕' },
  RELEASED: { cls: 'bg-red-500/15 text-red-300 border-red-400/30', icon: '✕' },
};

const FALLBACK = { cls: 'bg-gray-500/15 text-gray-300 border-gray-400/30', icon: '?' };

export const AdminLifecycleBadge = ({ status }: { status: string | null | undefined }) => {
  const style = (status && STYLE[status]) || FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${style.cls}`}>
      <span aria-hidden="true">{style.icon}</span>
      {status ?? 'UNKNOWN'}
    </span>
  );
};
