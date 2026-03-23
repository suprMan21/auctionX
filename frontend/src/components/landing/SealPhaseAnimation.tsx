import { useEffect, useRef, useState } from 'react';

interface SealPhaseAnimationProps {
  variant: 'sealed' | 'proof';
}

const phases = {
  sealed: [
    { number: 1, title: 'Creator records', description: 'Item in hand, story in their words', icon: '🎬' },
    { number: 2, title: 'We seal it', description: 'NFC tag linked to permanent digital record', icon: '🔒' },
    { number: 3, title: 'Ships with the piece', description: 'Tag on the item, story in the tag', icon: '📦' },
    { number: 4, title: 'Collector taps to verify', description: 'Phone vibrates, creator video loads, certificate appears. No app. No friction.', icon: '📱' },
  ],
  proof: [
    { number: 1, title: 'The provenance is documented', description: 'Item history, condition, chain of custody', icon: '📋' },
    { number: 2, title: 'We seal it', description: 'NFC tag linked to permanent digital record', icon: '🔒' },
    { number: 3, title: 'Ships with the piece', description: 'Tag on the item, story in the tag', icon: '📦' },
    { number: 4, title: 'Anyone taps to verify', description: 'Phone vibrates, record loads, certificate appears. No app. No friction.', icon: '📱' },
  ],
};

const animationClasses = [
  'phase-animate-scale',
  'phase-animate-pulse',
  'phase-animate-slide',
  'phase-animate-fade',
];

export const SealPhaseAnimation = ({ variant }: SealPhaseAnimationProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentPhases = phases[variant];
  const accentColor = variant === 'sealed' ? 'primary' : 'accent';

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="w-full max-w-5xl mx-auto px-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {currentPhases.map((phase, index) => (
          <div
            key={phase.number}
            className={`relative glass rounded-2xl p-6 transition-all ${
              isVisible ? animationClasses[index] : 'opacity-0'
            }`}
            style={{
              animationDelay: isVisible ? `${index * 400}ms` : '0ms',
              animationFillMode: 'forwards',
            }}
          >
            {/* Phase number */}
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold mb-4 ${
                accentColor === 'primary'
                  ? 'bg-primary-500/20 text-primary-400'
                  : 'bg-accent-500/20 text-accent-400'
              }`}
            >
              {phase.number}
            </div>

            {/* Icon animation area */}
            <div className="text-3xl mb-3" aria-hidden="true">
              {phase.icon}
            </div>

            {/* Content */}
            <h3 className="text-white font-semibold text-lg mb-2">
              {phase.title}
            </h3>
            <p className="text-gray-400 text-sm leading-relaxed">
              {phase.description}
            </p>

            {/* Connector line (not on last item) */}
            {index < 3 && (
              <div
                className={`hidden lg:block absolute top-1/2 -right-3 w-6 h-px ${
                  accentColor === 'primary' ? 'bg-primary-500/30' : 'bg-accent-500/30'
                }`}
                aria-hidden="true"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
