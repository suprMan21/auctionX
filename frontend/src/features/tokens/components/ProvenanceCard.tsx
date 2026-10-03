import { Link } from 'react-router-dom';
import type { Provenance } from '../api/schemas';

const formatDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

/** Only https links are rendered; anything else is shown as unavailable. */
const safeHttpsUrl = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
};

/**
 * The public story of a token: only what the creator released AND the current
 * owner chose to show (the backend view applies both gates). Never an owner.
 */
export const ProvenanceCard = ({ provenance }: { provenance: Provenance | null }) => {
  const rows: Array<{ label: string; value: React.ReactNode }> = [];

  if (provenance?.creator_name) rows.push({ label: 'Creator', value: provenance.creator_name });
  if (provenance?.origin_location) rows.push({ label: 'Origin', value: provenance.origin_location });
  const originDate = formatDate(provenance?.origin_date ?? null);
  if (originDate) rows.push({ label: 'Origin date', value: originDate });
  const claimDate = formatDate(provenance?.claim_date ?? null);
  if (claimDate) rows.push({ label: 'Claimed', value: claimDate });
  const video = safeHttpsUrl(provenance?.origin_video_url ?? null);
  if (video) {
    rows.push({
      label: 'Origin video',
      value: (
        <a href={video} target="_blank" rel="noopener noreferrer" className="text-primary-300 underline hover:text-primary-200">
          Watch the origin video<span className="sr-only"> (opens in a new tab)</span>
        </a>
      ),
    });
  }

  return (
    <section aria-labelledby="provenance-heading" className="glass rounded-2xl p-6">
      <h2 id="provenance-heading" className="text-lg font-semibold text-white mb-4">
        The story
      </h2>
      {rows.length === 0 ? (
        <p className="text-gray-400 text-sm">The owner has not shared origin details for this token.</p>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-3 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-gray-400">{row.label}</dt>
              <dd className="text-white">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {provenance?.current_ownership_id && (
        <p className="mt-5 pt-4 border-t border-white/10 text-xs text-gray-400">
          Ownership ID{' '}
          <Link
            to={`/ownership/${provenance.current_ownership_id}`}
            className="font-mono text-gray-300 break-all underline hover:text-white"
          >
            {provenance.current_ownership_id}
          </Link>
        </p>
      )}
    </section>
  );
};
