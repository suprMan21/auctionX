import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from './features/auth/hooks/useAuth';
// Auth pages kept for post-launch; currently routed to ComingSoonPage
// import { LoginPage } from './features/auth/pages/LoginPage';
// import { SignupPage } from './features/auth/pages/SignupPage';
import { ForgotPasswordPage } from './features/auth/pages/ForgotPasswordPage';
import { ProfilePage } from './features/profile/pages/ProfilePage';
import { SellerProfilePage } from './features/profile/pages/SellerProfilePage';
import { CreateListing } from './pages/CreateListing';
import { MyListings } from './pages/MyListings';
import { ViewListing } from './pages/ViewListing';
import { AuctionDetailPage } from './features/auctions/components/AuctionDetailPage';
import { Header } from './components/navigation/Header';
import { BrowsePage } from '@/pages/BrowsePage';
import { SearchResultsPage } from '@/pages/SearchResultsPage';
import { SettlementPage } from './pages/SettlementPage';
import { PayoutsPage } from './pages/PayoutsPage';
import { TokenCreationPage } from './features/verification/pages/TokenCreationPage';
import { SavedSearchesPage } from '@/pages/SavedSearchesPage';
import { ConversationsPage } from './features/messaging/pages/ConversationsPage';
import { VerificationPage } from './features/verification/pages/VerificationPage';
const NfcDashboardPage = lazy(() => import('./features/verification/pages/NfcDashboardPage').then(m => ({ default: m.NfcDashboardPage })));
const NfcTagDetailPage = lazy(() => import('./features/verification/pages/NfcTagDetailPage').then(m => ({ default: m.NfcTagDetailPage })));
const NfcScanPage = lazy(() => import('./features/verification/pages/NfcScanPage').then(m => ({ default: m.NfcScanPage })));
import { AdminProtectedRoute } from '@/features/admin/components/AdminProtectedRoute';
import { AdminLayout } from '@/features/admin/AdminLayout';
import { AdminDashboardPage } from '@/features/admin/pages/AdminDashboardPage';
import { AdminUsersPage } from '@/features/admin/pages/AdminUsersPage';
import { AdminUserDetailPage } from '@/features/admin/pages/AdminUserDetailPage';
import { AdminModerationPage } from '@/features/admin/pages/AdminModerationPage';
import { AdminAuditLogPage } from '@/features/admin/pages/AdminAuditLogPage';
import { AdminHealthPage } from '@/features/admin/pages/AdminHealthPage';
import { NotificationsPage } from './features/notifications/pages/NotificationsPage';
import { NotificationPreferencesPage } from './features/notifications/pages/NotificationPreferencesPage';
import { AgeGateGuard } from '@/components/AgeGate/AgeGateGuard';
import { UnmentionablesBrowsePage } from '@/pages/UnmentionablesBrowsePage';
import { Dashboard } from '@/pages/Dashboard';
import { CollectorLandingPage } from '@/pages/CollectorLandingPage';
import { CreatorLandingPage } from '@/pages/CreatorLandingPage';
import { AMSealedPage } from '@/pages/AMSealedPage';
import { AMProofPage } from '@/pages/AMProofPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { SellerVerificationPage } from '@/features/seller-verification/pages/SellerVerificationPage';
import { AdminSellerVerificationPage } from '@/features/admin/pages/AdminSellerVerificationPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, initialized } = useAuth();

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <>
      <Header />
      {children}
    </>
  );
}

function PublicWithHeader({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        {/* Ambient background blobs */}
        <div className="ambient-bg" aria-hidden="true">
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
        </div>
        {/* Noise texture overlay */}
        <div className="noise-overlay" aria-hidden="true" />

        <Routes>
          {/* Landing pages -- static routes, no app header */}
          <Route path="/collector" element={<CollectorLandingPage />} />
          <Route path="/creator" element={<CreatorLandingPage />} />
          <Route path="/am-sealed" element={<AMSealedPage />} />
          <Route path="/am-proof" element={<AMProofPage />} />

          <Route path="/login" element={<ComingSoonPage />} />
          <Route path="/register" element={<ComingSoonPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/listings/create"
            element={
              <ProtectedRoute>
                <CreateListing />
              </ProtectedRoute>
            }
          />

          <Route
            path="/listings/:id/edit"
            element={
              <ProtectedRoute>
                <CreateListing />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/my-listings"
            element={
              <ProtectedRoute>
                <MyListings />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/unmentionables"
            element={
              <AgeGateGuard>
                <UnmentionablesBrowsePage />
              </AgeGateGuard>
            }
          />
          <Route
            path="/seller-verification"
            element={
              <ProtectedRoute>
                <SellerVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route path="/browse" element={<PublicWithHeader><BrowsePage /></PublicWithHeader>} />
          <Route path="/browse/:categorySlug" element={<PublicWithHeader><BrowsePage /></PublicWithHeader>} />
          <Route path="/search" element={<PublicWithHeader><SearchResultsPage /></PublicWithHeader>} />
          <Route path="/listings/:id" element={<PublicWithHeader><ViewListing /></PublicWithHeader>} />

          {/* NFC Tag Management — static routes before parameterized (lesson #5) */}
          <Route path="/nfc/scan" element={<PublicWithHeader><Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}><NfcScanPage /></Suspense></PublicWithHeader>} />
          <Route
            path="/nfc"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}><NfcDashboardPage /></Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/nfc/:tagId"
            element={
              <ProtectedRoute>
                <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gray-400">Loading...</div></div>}><NfcTagDetailPage /></Suspense>
              </ProtectedRoute>
            }
          />

          {/* NFC Verification — /verify/create/:verificationId MUST precede /verify/:tokenName */}
          <Route
            path="/verify/create/:verificationId"
            element={
              <ProtectedRoute>
                <TokenCreationPage />
              </ProtectedRoute>
            }
          />
          <Route path="/verify/:tokenName" element={<PublicWithHeader><VerificationPage /></PublicWithHeader>} />
          <Route path="/auctions/:id" element={<PublicWithHeader><AuctionDetailPage /></PublicWithHeader>} />
          <Route path="/seller/:id" element={<PublicWithHeader><SellerProfilePage /></PublicWithHeader>} />

          <Route
            path="/settlements/:settlementId"
            element={
              <ProtectedRoute>
                <SettlementPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/payouts"
            element={
              <ProtectedRoute>
                <PayoutsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/saved-searches"
            element={
              <ProtectedRoute>
                <SavedSearchesPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <ConversationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/messages/:conversationId"
            element={
              <ProtectedRoute>
                <ConversationsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings/notifications"
            element={
              <ProtectedRoute>
                <NotificationPreferencesPage />
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<CollectorLandingPage />} />

          {/* Admin routes — protected by AdminProtectedRoute */}
          <Route path="/admin" element={<AdminProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:id" element={<AdminUserDetailPage />} />
              <Route path="moderation" element={<AdminModerationPage />} />
              <Route path="seller-verification" element={<AdminSellerVerificationPage />} />
              <Route path="audit-logs" element={<AdminAuditLogPage />} />
              <Route path="health" element={<AdminHealthPage />} />
            </Route>
          </Route>

          {/* Catch-all: unknown paths → landing page */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1a1a24',
              color: '#f4f4f5',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
            },
            success: {
              duration: 3000,
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              duration: 5000,
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
