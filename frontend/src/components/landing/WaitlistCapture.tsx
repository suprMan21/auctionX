import { FormEvent, useState } from 'react';
import { Button } from '@/components/common/Button';

export const WaitlistCapture = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
    }
  };

  return (
    <section className="bg-landing-dark py-24 px-4">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          This is where collectors find what's real.
        </h2>
        <p className="text-gray-400 mb-8 text-lg">
          Be the first to know when new collections go live.
        </p>

        {submitted ? (
          <div className="glass rounded-2xl p-8">
            <p className="text-white text-lg font-medium">You're on the list.</p>
            <p className="text-gray-400 mt-2">We'll be in touch.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <label htmlFor="waitlist-email" className="sr-only">
              Email address
            </label>
            <input
              id="waitlist-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="flex-1 min-h-[44px] px-4 py-3 rounded-btn bg-white/[0.04] backdrop-blur-xl border border-white/[0.08] text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark"
            />
            <Button type="submit" variant="primary">
              Join the list
            </Button>
          </form>
        )}
      </div>
    </section>
  );
};
