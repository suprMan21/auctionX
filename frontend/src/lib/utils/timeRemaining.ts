/**
 * timeRemaining — Calculates human-readable countdown from an end time
 *
 * @param endTime - ISO date string for auction end time
 * @returns Formatted string: "2d 4h left", "4h 30m left", "45m left", or "Ended"
 *
 * Note: Point-in-time calculation only — NOT a live countdown.
 * The auction detail page (Module 08) handles real-time countdown via useCountdown hook.
 *
 * @module Module 06 — Browse & Search
 */
export function timeRemaining(endTime: string): string {
  const diff = new Date(endTime).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
