import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { LandingNav } from '@/components/landing/LandingNav';
import { ProductToggle } from '@/components/landing/ProductToggle';
import { SealPhaseAnimation } from '@/components/landing/SealPhaseAnimation';

export const AMSealedPage = () => {
  return (
    <div className="bg-landing-dark min-h-screen">
      {/* ── Nav ── */}
      <LandingNav />

      {/* ── Product Toggle ── */}
      <ProductToggle />

      {/* ── Headline + Intro ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            AM Sealed. Sealed by the artist.
          </h1>

          <p className="mt-6 text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Creator-initiated authentication. The creator applies the seal
            themselves. Their creation video, their words, their hands on the
            item. The creator identity IS the provenance.
          </p>
        </div>
      </section>

      {/* ── Main Copy ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-lg text-gray-300 leading-relaxed text-center">
            AM Sealed starts the moment a creator decides a piece is ready to
            leave their hands. They record a video -- the item in their hands,
            their words about what it is and where it came from. We seal that
            video to a physical NFC tag, link it to a permanent record, and ship
            it with the piece. Whoever owns it taps the tag. They see the
            creator. They hear the story. Directly from the source.
          </p>
        </div>
      </section>

      {/* ── Key Line ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-2xl md:text-3xl font-bold text-gradient leading-snug">
            The creator sealed it. That is what makes it real.
          </p>
        </div>
      </section>

      {/* ── Seal Phase Animation ── */}
      <section className="py-20 px-4">
        <SealPhaseAnimation variant="sealed" />
      </section>

      {/* ── Trust Note ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="glass rounded-2xl p-8 md:p-10 text-center">
            <p className="text-lg text-gray-300 leading-relaxed">
              AM Sealed is available on any creator-origin item. Optional. Yours
              to offer when the piece deserves it.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTAs ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/register"
            className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
          >
            <Button variant="primary" size="lg" tabIndex={-1}>
              Start sealing your work
            </Button>
          </Link>
          <Link
            to="/browse"
            className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-btn"
          >
            <Button variant="secondary" size="lg" tabIndex={-1}>
              Browse AM Sealed items
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Cross-link to AM Proof ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-gray-400 text-base">
            Looking for provenance documentation on a third-party collectible?{' '}
            <Link
              to="/am-proof"
              className="text-primary-400 hover:text-primary-300 underline underline-offset-4 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-landing-dark rounded-sm"
            >
              See AM Proof
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
};
