import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { LandingNav } from '@/components/landing/LandingNav';
import { WaitlistCapture } from '@/components/landing/WaitlistCapture';

const steps = [
  {
    number: 1,
    title: 'Browse creator storefronts',
    description: 'Permanent collections, always open',
  },
  {
    number: 2,
    title: 'Bid in live auctions',
    description: 'Timed events, one winner, real competition',
  },
  {
    number: 3,
    title: 'Tap to verify',
    description:
      'AM Proof available on any item. Phone vibrates. Story loads. No app needed.',
  },
];

export const CollectorLandingPage = () => {
  return (
    <div className="min-h-screen">
      {/* ── Nav ── */}
      <LandingNav />

      {/* ── Hero ── */}
      <section className="bg-landing-dark py-24 px-4">
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">

          <h1 className="mt-12 text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            Some things are worth remembering. Fewer are worth keeping.
          </h1>

          <p className="mt-6 text-lg md:text-xl text-gray-400 max-w-2xl">
            Creator collectibles with the story already in them. Browse
            storefronts, compete in live auctions, build a collection that means
            something.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              to="/browse"
              className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
            >
              <Button variant="primary" size="lg" tabIndex={-1}>
                Browse Collections
              </Button>
            </Link>
            <Link
              to="/browse"
              className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
            >
              <Button variant="secondary" size="lg" tabIndex={-1}>
                See What's Live
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Core Content ── */}
      <section className="bg-landing-light py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center">
            A collection of pieces. A record of moments.
          </h2>

          <p className="mt-8 text-lg text-gray-700 leading-relaxed text-center max-w-3xl mx-auto">
            Objects do not have meaning on their own. The meaning comes from
            knowing where something was, who had it, what it cost them to let it
            go. Every piece here came from a real person with a real story. The
            collection you build is a map of what mattered to you -- and we make
            sure none of it gets lost along the way.
          </p>

          <p className="mt-6 text-lg text-gray-600 text-center">
            Browse storefronts. Compete for what you actually want. Keep what has
            a story.
          </p>

          <p className="mt-10 text-sm font-medium tracking-wide uppercase text-gray-500 text-center">
            Real pieces. Real origins. The story sealed in.
          </p>
        </div>
      </section>

      {/* ── AM Proof ── */}
      <section className="bg-landing-dark py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="glass rounded-2xl p-10 md:p-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center">
              The story travels with it.
            </h2>

            <p className="mt-8 text-lg text-gray-300 leading-relaxed text-center max-w-3xl mx-auto">
              When a creator adds AM Proof to a piece, they record a video with
              it in hand -- the item, the story, their words. We seal that to the
              piece permanently. Tap the seal with your phone. Watch where it came
              from. See the moment it was made. Not every piece has it. When one
              does, the story is real and it stays real -- wherever the piece goes
              next.
            </p>

            <div className="mt-10 flex justify-center">
              <Link
                to="/am-proof"
                className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
              >
                <Button variant="secondary" size="lg" tabIndex={-1}>
                  How AM Proof works
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="bg-landing-light py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-medium tracking-wide uppercase text-gray-500 text-center mb-4">
            Find the piece. Keep the story.
          </p>

          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center mb-14">
            How It Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step) => (
              <div
                key={step.number}
                className="bg-white rounded-2xl shadow-lg p-8 text-center"
              >
                <span
                  className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-900 text-white text-xl font-bold mb-6"
                  aria-hidden="true"
                >
                  {step.number}
                </span>
                <h3 className="text-xl font-semibold text-gray-900">
                  {step.title}
                </h3>
                <p className="mt-3 text-gray-600 leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Waitlist / CTA ── */}
      <div>
        <div className="bg-landing-dark pt-10 pb-0 px-4">
          <p className="text-sm font-medium tracking-wide uppercase text-gray-500 text-center">
            Some collections are just stuff. Build something else.
          </p>
        </div>
        <WaitlistCapture />
      </div>
    </div>
  );
};
