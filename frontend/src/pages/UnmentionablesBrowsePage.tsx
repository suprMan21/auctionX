import { Header } from '@/components/navigation/Header';

export function UnmentionablesBrowsePage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-dark-800">
        {/* Hero */}
        <section className="relative overflow-hidden py-24 px-4">
          {/* Background glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-unmentionables-500/10 rounded-full blur-3xl" />
          </div>

          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h1 className="text-5xl sm:text-6xl font-bold text-gradient-unmentionables mb-2">
              Unmentionables
            </h1>
            <p className="text-gray-400 text-lg mb-8">by Authentic Materials</p>
            <p className="text-gray-300 text-xl max-w-xl mx-auto">
              The exclusive marketplace for personal items and creator collectibles. Coming soon.
            </p>
          </div>
        </section>

        {/* Placeholder grid */}
        <section className="max-w-7xl mx-auto px-4 pb-24">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="glass rounded-2xl overflow-hidden animate-pulse"
              >
                <div className="w-full h-56 bg-dark-700" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-dark-600 rounded w-3/4" />
                  <div className="h-6 bg-dark-600 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
