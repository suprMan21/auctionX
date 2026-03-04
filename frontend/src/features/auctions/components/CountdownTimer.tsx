import { useCountdown } from '../hooks/useCountdown';

interface CountdownTimerProps {
  endTime: string;
}

export function CountdownTimer({ endTime }: CountdownTimerProps) {
  const { days, hours, minutes, seconds, isExpired } = useCountdown(endTime);

  if (isExpired) {
    return (
      <div className="text-red-400 font-semibold">
        Auction Ended
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {days > 0 && (
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{days}</div>
          <div className="text-xs text-gray-400">Days</div>
        </div>
      )}
      <div className="text-center">
        <div className="text-2xl font-bold text-white">{hours}</div>
        <div className="text-xs text-gray-400">Hours</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold text-white">{minutes}</div>
        <div className="text-xs text-gray-400">Minutes</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold text-white">{seconds}</div>
        <div className="text-xs text-gray-400">Seconds</div>
      </div>
    </div>
  );
}
