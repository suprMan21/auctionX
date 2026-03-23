import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { AMWordmark } from '@/components/landing/AMWordmark';
import { WaitlistCapture } from '@/components/landing/WaitlistCapture';

const steps = [
  {
    number: 1,
    title: 'Build your storefront',
    description: 'Your brand, your pricing, always open to your collectors',
  },
  {
    number: 2,
    title: 'Drop live auctions',
    description: 'Create the event, let collectors compete, you set the floor',
  },
  {
    number: 3,
    title: 'Record AM Sealed',
    description:
      'The item in your hands, your story in your words. We handle the rest.',
  },
];

export const CreatorLandingPage = () => {
  return (
    <div className="min-h-screen">
      {/* ── Hero ── */}
      <section className="bg-landing-dark py-24 px-4">
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          <AMWordmark size="lg" />

          <h1 className="mt-12 text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            Your creation. Your stage.
          </h1>

          <p className="mt-6 text-lg md:text-xl text-gray-400 max-w-2xl">
            Run your own storefront. Host live auctions. Every piece you
            release, your story sealed inside it permanently.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              to="/register"
              className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
            >
              <Button variant="primary" size="lg" tabIndex={-1}>
                Start Your Storefront
              </Button>
            </Link>
            <Link
              to="/register"
              className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
            >
              <Button variant="secondary" size="lg" tabIndex={-1}>
                Apply as a Creator
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Core Content ── */}
      <section className="bg-landing-light py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 text-center">
            What you have made has value. The video proves it.
          </h2>

          <p className="mt-8 text-lg text-gray-700 leading-relaxed text-center max-w-3xl mx-auto">
            Your storefront stays open. Your auctions build moments. Every
            piece you release carries a short video from you -- the item in
            your hands, your words about where it came from. That video seals
            to the piece permanently. Collectors tap it. They watch you. Your
            name stays on it no matter where it ends up. You set the price. You
            run the timeline. The platform works around you.
          </p>

          <p className="mt-10 text-sm font-medium tracking-wide uppercase text-gray-500 text-center">
            Your creation. Their collection. Your name on it forever.
          </p>
        </div>
      </section>

      {/* ── AM Sealed ── */}
      <section className="bg-landing-dark py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="glass rounded-2xl p-10 md:p-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white text-center">
              One video. Your name on it forever.
            </h2>

            <p className="mt-8 text-lg text-gray-300 leading-relaxed text-center max-w-3xl mx-auto">
              AM Sealed starts with you -- the item in your hands, your words,
              your story. We seal it to a physical NFC tag, link it to a
              permanent record, and ship it with the piece. Whoever has that
              item, wherever it travels, taps the seal and sees you. No app. No
              friction. Just proof that it is real and that it came from you.
            </p>

            <p className="mt-6 text-base text-gray-400 text-center">
              Optional on every item. Yours to offer when the piece deserves it.
            </p>

            <div className="mt-10 flex justify-center">
              <Link
                to="/am-sealed"
                className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
              >
                <Button variant="secondary" size="lg" tabIndex={-1}>
                  See how AM Sealed works
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
            Build the hype. Start the bidding. Ride the wave.
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
            The pieces you release. The story they carry.
          </p>
        </div>
        <WaitlistCapture />
      </div>
    </div>
  );
};
