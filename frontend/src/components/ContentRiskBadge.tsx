interface ContentRiskBadgeProps {
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  label?: string;
}

export function ContentRiskBadge({ risk, label }: ContentRiskBadgeProps) {
  if (risk === 'LOW') return null;

  if (risk === 'MEDIUM') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full glass text-xs font-medium text-accent-300">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-500" aria-hidden="true" />
        {label ?? 'Creator'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full glass text-xs font-medium text-unmentionables-300">
      <span className="w-1.5 h-1.5 rounded-full bg-unmentionables-500" aria-hidden="true" />
      {label ?? '18+'}
    </span>
  );
}
