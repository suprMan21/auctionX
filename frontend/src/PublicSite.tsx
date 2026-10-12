import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * The public site: what authentic-materials.com serves (`npm run build:public`).
 *
 * Landing pages only. The app (sign-in, My Tokens, admin, payments) is not
 * imported here, so none of its code, routes or keys reach the public bundle;
 * it lives on staging until launch. Add a page here only if it makes no API
 * call. `src/publicSite.test.ts` enforces that.
 */
export const PublicSite = () => (
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
);
