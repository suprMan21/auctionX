import { AMWordmark } from '@/components/landing/AMWordmark';

/**
 * `/` — the public home page after the 2026-09-18 token-first pivot.
 *
 * Deliberately short and light on detail: it is what partners and suppliers see
 * first. Brand rules (Notion Brand Voice + Pitches v2.0 + Locked decisions):
 *   - say "seal", never token / NFT / blockchain / crypto; no chip or security details;
 *   - no em dashes; no claims that a seal makes anything worth more;
 *   - "designed to resist copying", never "cannot be copied";
 *   - headlines are declarative, all caps, ending with a period;
 *   - nothing about the parked marketplace or any other brand.
 * Cinema palette: #070709 background, sharp corners, uppercase display type.
 */

export const CONTACT_EMAIL = 'hello@authentic-materials.com';
const mailto = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

const STEPS = [
  {
    title: 'LOOK FOR IT.',
    body: 'A small AM seal, applied to the piece at the source.',
  },
  {
    title: 'TAP IT.',
    body: 'Hold your phone to the seal. See where it came from and that it is the real one. No app. No login.',
  },
  {
    title: 'KEEP IT.',
    body: 'When the piece changes hands, its record goes with it to the next owner.',
  },
] as const;

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070709]';

const CtaLink = ({ href, children, variant = 'primary' }: { href: string; children: React.ReactNode; variant?: 'primary' | 'secondary' }) => (
  <a
    href={href}
    className={`inline-flex items-center justify-center h-14 px-8 rounded-[4px] text-sm font-bold tracking-[0.08em] uppercase transition-colors ${FOCUS}
      ${variant === 'primary'
        ? 'bg-[#7c3aed] text-white hover:bg-[#6d28d9]'
        : 'border border-white/30 text-white hover:border-white/60'}`}
  >
    {children}
  </a>
);

export const HomePage = () => (
  <div className="min-h-screen bg-[#070709] text-[#F0F0F0]">
    <header className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
      <AMWordmark size="sm" />
      <a href={mailto('Hello from authentic-materials.com')} className={`text-sm font-semibold tracking-[0.08em] uppercase text-gray-300 hover:text-white rounded-sm ${FOCUS}`}>
        Contact
      </a>
    </header>

    <main id="main-content">
      {/* ── Hero ── */}
      <section className="px-4 pt-20 pb-28 md:pt-28 md:pb-36">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs md:text-sm font-semibold tracking-[0.2em] uppercase text-[#a78bfa]">Authentic Materials</p>
          <h1 className="mt-6 text-5xl md:text-7xl font-bold tracking-[0.04em] uppercase leading-[1.05] text-white">
            Sealed with a story.
          </h1>
          <p className="mt-8 text-lg md:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
            Tap your phone to anything with an AM seal and see where it came from, who sealed it, and that it is the
            real one. No app.
          </p>
          <div className="mt-12">
            <CtaLink href={mailto('Working with Authentic Materials')}>Get in touch</CtaLink>
          </div>
        </div>
      </section>

      {/* ── Look for it. Tap it. Keep it. ── */}
      <section aria-labelledby="how-heading" className="px-4 py-24 border-t border-white/10">
        <div className="max-w-6xl mx-auto">
          <h2 id="how-heading" className="text-3xl md:text-5xl font-bold tracking-[0.04em] uppercase text-center text-white">
            Look for it. Tap it. Keep it.
          </h2>
          <ol className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((step) => (
              <li key={step.title} className="rounded-[4px] border border-white/10 bg-white/[0.02] p-8">
                <h3 className="text-lg font-bold tracking-[0.08em] text-white">{step.title}</h3>
                <p className="mt-4 text-gray-300 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Why the seal matters ── */}
      <section aria-labelledby="why-heading" className="px-4 py-24 border-t border-white/10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 id="why-heading" className="text-3xl md:text-5xl font-bold tracking-[0.04em] uppercase text-white">
            Why the seal matters.
          </h2>
          <p className="mt-8 text-lg text-gray-300 leading-relaxed">
            A certificate can be copied. A story can be made up. The AM seal ties a physical piece to its record, and it
            is designed to resist copying. It stays with the item wherever it is sold next.
          </p>
          <p className="mt-6 text-sm font-semibold tracking-[0.2em] uppercase text-[#a78bfa]">Where it came from matters.</p>
        </div>
      </section>

      {/* ── Partners ── */}
      <section aria-labelledby="partners-heading" className="px-4 py-24 border-t border-white/10">
        <div className="max-w-3xl mx-auto text-center">
          <h2 id="partners-heading" className="text-3xl md:text-5xl font-bold tracking-[0.04em] uppercase text-white">
            Work with us.
          </h2>
          <p className="mt-8 text-lg text-gray-300 leading-relaxed">
            We work with makers and suppliers who take provenance seriously. If that sounds like you, we would like to
            hear from you.
          </p>
          <div className="mt-10">
            <CtaLink href={mailto('Partnership enquiry')} variant="secondary">Email us</CtaLink>
          </div>
          <p className="mt-4 text-sm text-gray-400">{CONTACT_EMAIL}</p>
        </div>
      </section>
    </main>

    <footer className="px-4 py-10 border-t border-white/10">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-gray-500">
        <p>© {new Date().getFullYear()} The Craving Company Inc.</p>
        <a href={mailto('Hello from authentic-materials.com')} className={`hover:text-gray-300 rounded-sm ${FOCUS}`}>{CONTACT_EMAIL}</a>
      </div>
    </footer>
  </div>
);
