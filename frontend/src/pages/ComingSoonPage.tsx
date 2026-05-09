import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { AMWordmark } from '@/components/landing/AMWordmark';

export const ComingSoonPage = () => {
  return (
    <div className="min-h-screen bg-dark-800 flex flex-col items-center justify-center px-4">
      <AMWordmark size="lg" />

      <h1 className="mt-12 text-4xl md:text-5xl font-bold text-white text-center">
        Coming Soon
      </h1>

      <p className="mt-6 text-lg text-gray-400 text-center max-w-md">
        We're building something worth waiting for. Join the list on our home
        page to be first in line.
      </p>

      <div className="mt-10">
        <Link
          to="/"
          className="focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 rounded-btn"
        >
          <Button variant="primary" size="lg" tabIndex={-1}>
            Back to Home
          </Button>
        </Link>
      </div>
    </div>
  );
};
