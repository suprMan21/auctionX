import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgeVerification } from './useAgeVerification';

export function AgeGate() {
  const navigate = useNavigate();
  const { verify } = useAgeVerification();
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState('');

  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const handleMonthChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 2);
    setMonth(digits);
    if (digits.length === 2) dayRef.current?.focus();
  };

  const handleDayChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 2);
    setDay(digits);
    if (digits.length === 2) yearRef.current?.focus();
  };

  const handleYearChange = (val: string) => {
    setYear(val.replace(/\D/g, '').slice(0, 4));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    const y = parseInt(year, 10);

    if (!month || !day || year.length < 4) {
      setError('Please enter a complete date of birth.');
      return;
    }

    const ok = verify(m, d, y);
    if (!ok) {
      setError('You must be at least 18 years old to access this content.');
    }
  };

  const inputClass =
    'w-full h-12 px-3 rounded-xl bg-white/5 border border-white/10 text-white text-center text-lg ' +
    'placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-unmentionables-500';

  return (
    <div role="main" className="min-h-screen bg-dark-800 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-unmentionables-500/10 rounded-full blur-3xl" />
      </div>

      <div className="glass rounded-2xl p-8 max-w-md w-full relative z-10 text-center">
        {/* Lock icon */}
        <div className="mx-auto w-16 h-16 rounded-full bg-unmentionables-500/20 flex items-center justify-center mb-6 shadow-glow-unmentionables">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-unmentionables-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gradient-unmentionables mb-1">Unmentionables</h1>
        <p className="text-gray-400 text-sm mb-6">by Authentic Materials</p>
        <p className="text-gray-300 text-sm mb-6">
          This section contains age-restricted content. Please verify your date of birth to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="age-month" className="sr-only">Month</label>
              <input
                id="age-month"
                type="text"
                inputMode="numeric"
                placeholder="MM"
                value={month}
                onChange={(e) => handleMonthChange(e.target.value)}
                className={inputClass}
                aria-label="Month of birth"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="age-day" className="sr-only">Day</label>
              <input
                id="age-day"
                ref={dayRef}
                type="text"
                inputMode="numeric"
                placeholder="DD"
                value={day}
                onChange={(e) => handleDayChange(e.target.value)}
                className={inputClass}
                aria-label="Day of birth"
              />
            </div>
            <div>
              <label htmlFor="age-year" className="sr-only">Year</label>
              <input
                id="age-year"
                ref={yearRef}
                type="text"
                inputMode="numeric"
                placeholder="YYYY"
                value={year}
                onChange={(e) => handleYearChange(e.target.value)}
                className={inputClass}
                aria-label="Year of birth"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-unmentionables-400 text-sm">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full h-12 rounded-xl bg-gradient-unmentionables text-white font-semibold
                       hover:opacity-90 transition-opacity focus:outline-none focus:ring-2
                       focus:ring-unmentionables-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            Verify Age
          </button>

          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full h-12 rounded-xl glass text-gray-300 font-medium
                       hover:text-white hover:bg-white/10 transition-colors focus:outline-none
                       focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            Take me back
          </button>
        </form>
      </div>
    </div>
  );
}
