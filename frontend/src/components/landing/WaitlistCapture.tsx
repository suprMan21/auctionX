/**
 * Parked landing pages (staging only). Signups go through the homepage form only
 * (S-SITE2 G3: one route, consent shown and stored), so this links there instead of
 * writing to the table, which the public role can no longer do (migration 20261028000002).
 */
export const WaitlistCapture = () => (
  <section id="waitlist" className="bg-dark-900 py-24 px-4 scroll-mt-20">
    <div className="max-w-2xl mx-auto text-center">
      <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Get early access</h2>
      <p className="text-gray-400 mb-8 text-lg">Seals are on the way. Get on the list and hear it first.</p>
      <a
        href="/#access"
        className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-btn bg-gradient-primary text-white font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900"
      >
        Join the list
      </a>
    </div>
  </section>
);
