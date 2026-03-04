import { useState, useCallback } from 'react';

const STORAGE_KEY = 'am_age_verified';

export function useAgeVerification() {
  const [verified, setVerified] = useState(() => {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  });

  const verify = useCallback((month: number, day: number, year: number): boolean => {
    if (
      !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year) ||
      month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 9999
    ) {
      return false;
    }

    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return false;
    }

    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    const monthDiff = now.getMonth() - date.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
      age--;
    }

    if (age >= 18) {
      sessionStorage.setItem(STORAGE_KEY, 'true');
      setVerified(true);
      return true;
    }

    return false;
  }, []);

  const clearVerification = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setVerified(false);
  }, []);

  return { verified, verify, clearVerification };
}
