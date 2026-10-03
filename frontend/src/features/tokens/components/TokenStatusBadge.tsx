import { statusCopy, type StatusTone } from '../lib/copy';

const TONE_CLASSES: Record<StatusTone, string> = {
  good: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  neutral: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  bad: 'bg-red-500/15 text-red-300 border-red-400/30',
};

/** Shape carries the meaning too, so status is never conveyed by colour alone. */
const TONE_ICON: Record<StatusTone, string> = {
  good: '✓',
  neutral: '•',
  warning: '!',
  bad: '✕',
};

export const TokenStatusBadge = ({ status }: { status: string | null | undefined }) => {
  const copy = statusCopy(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${TONE_CLASSES[copy.tone]}`}
    >
      <span aria-hidden="true">{TONE_ICON[copy.tone]}</span>
      {copy.label}
    </span>
  );
};
