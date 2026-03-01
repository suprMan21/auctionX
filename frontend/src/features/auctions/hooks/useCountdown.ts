import { useState, useEffect } from 'react';

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

export function useCountdown(endTime: string): TimeLeft {
  const calculateTimeLeft = (): TimeLeft => {
    const difference = new Date(endTime).getTime() - Date.now();
    
    if (difference <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
    }
    
    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((difference / 1000 / 60) % 60),
      seconds: Math.floor((difference / 1000) % 60),
      isExpired: false,
    };
  };
  
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());
  
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);
    
    return () => clearInterval(timer);
  }, [endTime]);
  
  return timeLeft;
}
