import { useCountdown } from '../hooks/useCountdown';

interface CountdownTimerProps {
  endTime: string;
}

export function CountdownTimer({ endTime }: CountdownTimerProps) {
  const { days, hours, minutes, seconds, isExpired } = useCountdown(endTime);

  if (isExpired) {
    return (
      <div className="text-red-600 font-semibold">
        Auction Ended
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {days > 0 && (
        <div className="text-center">
          <div className="text-2xl font-bold">{days}</div>
          <div className="text-xs text-gray-600">Days</div>
        </div>
      )}
      <div className="text-center">
        <div className="text-2xl font-bold">{hours}</div>
        <div className="text-xs text-gray-600">Hours</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold">{minutes}</div>
        <div className="text-xs text-gray-600">Minutes</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold">{seconds}</div>
        <div className="text-xs text-gray-600">Seconds</div>
      </div>
    </div>
  );
}
