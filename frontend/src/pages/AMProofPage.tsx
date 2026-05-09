import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { LandingNav } from '@/components/landing/LandingNav';
import { ProductToggle } from '@/components/landing/ProductToggle';
import { SealPhaseAnimation } from '@/components/landing/SealPhaseAnimation';

export const AMProofPage = () => {
  return (
    <div className="bg-dark-900 min-h-screen">
      {/* ── Nav ── */}
      <LandingNav />

      {/* ── Product Toggle ── */}
      <ProductToggle />

      {/* ── Headline + Intro ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight">
            AM Proof. The story, sealed.
          </h1>

          <p className="mt-6 text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Chain of custody authentication. For third-party collectibles --
            graded cards, vintage figures, signed memorabilia -- where the
            item's documented history is what matters.
          </p>
        </div>
      </section>

      {/* ── Main Copy ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-lg text-gray-300 leading-relaxed text-center">
            Some pieces carry their own history. A graded first edition. A
            signed original. A vintage piece with a documented past. AM Proof
            seals that history to the item permanently. The record travels with
            it. Whoever has it next taps to verify and sees exactly where it
            came from.
          </p>
        </div>
      </section>

      {/* ── Key Line ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-2xl md:text-3xl font-bold text-gradient leading-snug">
            The item's history is what makes it real.
          </p>
        </div>
      </section>

      {/* ── Seal Phase Animation ── */}
      <section className="py-20 px-4">
        <SealPhaseAnimation variant="proof" />
      </section>

      {/* ── Trust Note ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="glass rounded-2xl p-8 md:p-10 text-center">
            <p className="text-lg text-gray-300 leading-relaxed">
              AM Proof is available on any item. Not every item has it. When one
              does, you will know.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto flex justify-center">
          <Link
            to="/browse"
            className="focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-dark-900 rounded-btn"
          >
            <Button variant="primary" size="lg" tabIndex={-1}>
              Browse AM Proof items
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Cross-link to AM Sealed ── */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-gray-400 text-base">
            A creator selling something they made or wore? That is{' '}
            <Link
              to="/am-sealed"
              className="text-accent-400 hover:text-accent-300 underline underline-offset-4 transition-colors focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 focus:ring-offset-dark-900 rounded-sm"
            >
              AM Sealed
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
};
