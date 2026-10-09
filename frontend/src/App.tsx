import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from './features/auth/hooks/useAuth';
import { LoginPage } from './features/auth/pages/LoginPage';
import { SignupPage } from './features/auth/pages/SignupPage';
import { ForgotPasswordPage } from './features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from './features/auth/pages/ResetPasswordPage';
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
import { TokenVerifyPage } from './features/tokens/pages/TokenVerifyPage';
import { MyTokensPage } from './features/tokens/pages/MyTokensPage';
import { TokenDetailPage } from './features/tokens/pages/TokenDetailPage';
import { ReissueRequestPage } from './features/tokens/pages/ReissueRequestPage';
import { ReissuePayPage } from './features/tokens/pages/ReissuePayPage';
import { OwnershipLookupPage } from './features/tokens/pages/OwnershipLookupPage';
import { hasSunParams } from './features/tokens/lib/tapUrl';
import { loadTap } from './features/tokens/lib/tapCache';
import { loginPathFor } from './features/auth/lib/safeNext';
import { AdminProtectedRoute } from '@/features/admin/components/AdminProtectedRoute';
import { AdminLayout } from '@/features/admin/AdminLayout';
import { AdminDashboardPage } from '@/features/admin/pages/AdminDashboardPage';
import { AdminUsersPage } from '@/features/admin/pages/AdminUsersPage';
import { AdminUserDetailPage } from '@/features/admin/pages/AdminUserDetailPage';
import { AdminModerationPage } from '@/features/admin/pages/AdminModerationPage';
import { AdminAuditLogPage } from '@/features/admin/pages/AdminAuditLogPage';
import { AdminHealthPage } from '@/features/admin/pages/AdminHealthPage';
import { AdminTagsPage } from '@/features/admin/pages/AdminTagsPage';
import { AdminTagDetailPage } from '@/features/admin/pages/AdminTagDetailPage';
import { AdminReissuePage } from '@/features/admin/pages/AdminReissuePage';
import { NotificationsPage } from './features/notifications/pages/NotificationsPage';
import { NotificationPreferencesPage } from './features/notifications/pages/NotificationPreferencesPage';
import { SettingsPayoutsPage } from './pages/SettingsPayoutsPage';
import { AgeGateGuard } from '@/components/AgeGate/AgeGateGuard';
import { UnmentionablesBrowsePage } from '@/pages/UnmentionablesBrowsePage';
import { Dashboard } from '@/pages/Dashboard';
import { isMarketplaceEnabledOnClient } from './lib/featureFlags';
import { NotFoundPage } from './pages/NotFoundPage';
import { CollectorLandingPage } from '@/pages/CollectorLandingPage';
import { CreatorLandingPage } from '@/pages/CreatorLandingPage';
import { AMSealedPage } from '@/pages/AMSealedPage';
import { AMProofPage } from '@/pages/AMProofPage';
import { SellerVerificationPage } from '@/features/seller-verification/pages/SellerVerificationPage';
import { YotiReturnHandler } from '@/features/seller-verification/components/YotiReturnHandler';
import { AdminSellerVerificationPage } from '@/features/admin/pages/AdminSellerVerificationPage';
import { AdminVerificationsPage } from '@/features/admin/pages/AdminVerificationsPage';
import { AdminVerificationDetailPage } from '@/features/admin/pages/AdminVerificationDetailPage';
import { AdminEscrowPage } from '@/features/admin/pages/AdminEscrowPage';
import { AdminAuctionsPage } from '@/features/admin/pages/AdminAuctionsPage';
import { AdminAuctionDetailPage } from '@/features/admin/pages/AdminAuctionDetailPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, initialized } = useAuth();
  const location = useLocation();

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!session) {
    // S-NFC3-FE: come back to the page that asked for sign-in.
    return <Navigate to={loginPathFor(location.pathname + location.search)} replace />;
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

/**
 * `/verify/:tokenName` — a chip tap (SUN params) or a remembered tap always goes
 * to the token verify page. Only with the parked marketplace switched on does a
 * bare token name fall back to the legacy marketplace verification page.
 */
function VerifyRoute({ marketplaceEnabled }: { marketplaceEnabled: boolean }) {
  const { tokenName = '' } = useParams();
  const location = useLocation();
  const legacy = marketplaceEnabled && !hasSunParams(location.search) && !loadTap(tokenName);
  return legacy ? <VerificationPage /> : <TokenVerifyPage />;
}

function App() {
  // S-ISO1: parked marketplace. Read once per render; the value is fixed at
  // build time by VITE_FEATURE_MARKETPLACE.
  const marketplaceEnabled = isMarketplaceEnabledOnClient();

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

          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          
          {/* ── PARKED marketplace routes (S-ISO1) ──────────────────────────
              Hidden when VITE_FEATURE_MARKETPLACE is off. React Router recurses
              into fragments, so a conditional group works here. Nothing is
              deleted — flip the flag to restore. */}
          {marketplaceEnabled && (<>
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
          </>)}
          
          {marketplaceEnabled && (<>
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
          {/* S22: canonical seller-verification path. Old /seller-verification
              kept as alias so existing links don't 404. Static return route
              MUST come before any parameterized siblings (Lesson #5). */}
          <Route
            path="/seller/verification/return"
            element={
              <ProtectedRoute>
                <YotiReturnHandler />
              </ProtectedRoute>
            }
          />
          <Route
            path="/seller/verification"
            element={
              <ProtectedRoute>
                <SellerVerificationPage />
              </ProtectedRoute>
            }
          />
          </>)}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {marketplaceEnabled && (<>
          <Route path="/browse" element={<PublicWithHeader><BrowsePage /></PublicWithHeader>} />
          <Route path="/browse/:categorySlug" element={<PublicWithHeader><BrowsePage /></PublicWithHeader>} />
          <Route path="/search" element={<PublicWithHeader><SearchResultsPage /></PublicWithHeader>} />
          <Route path="/listings/:id" element={<PublicWithHeader><ViewListing /></PublicWithHeader>} />
          </>)}

          {/* ── Token platform (S-NFC3-FE) ──────────────────────────────────
              Static routes before parameterized (lesson #5). */}
          <Route
            path="/tokens"
            element={
              <ProtectedRoute>
                <MyTokensPage />
              </ProtectedRoute>
            }
          />
          {/* S-ADMIN1 Ph2: the approval email links here. Web only (no app store fees). */}
          <Route
            path="/tokens/reissue/:requestId/pay"
            element={
              <ProtectedRoute>
                <ReissuePayPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tokens/:tagId"
            element={
              <ProtectedRoute>
                <TokenDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tokens/:tagId/replace"
            element={
              <ProtectedRoute>
                <ReissueRequestPage />
              </ProtectedRoute>
            }
          />
          <Route path="/ownership/:ownershipId" element={<PublicWithHeader><OwnershipLookupPage /></PublicWithHeader>} />

          {/* ── PARKED marketplace-era NFC pages (S-NFC3-FE, decision D3) ───
              They call the parked /nfc/register, /transfer and /mint routes.
              With the marketplace off, /nfc goes to My Tokens instead. */}
          {marketplaceEnabled ? (<>
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
          {/* /verify/create/:verificationId MUST precede /verify/:tokenName */}
          <Route
            path="/verify/create/:verificationId"
            element={
              <ProtectedRoute>
                <TokenCreationPage />
              </ProtectedRoute>
            }
          />
          </>) : (
          <Route path="/nfc" element={<Navigate to="/tokens" replace />} />
          )}

          {/* Where a chip tap lands. */}
          <Route path="/verify/:tokenName" element={<PublicWithHeader><VerifyRoute marketplaceEnabled={marketplaceEnabled} /></PublicWithHeader>} />
          {marketplaceEnabled && (<>
          <Route path="/auctions/:id" element={<PublicWithHeader><AuctionDetailPage /></PublicWithHeader>} />
          <Route path="/seller/:id" element={<PublicWithHeader><SellerProfilePage /></PublicWithHeader>} />
          </>)}

          {marketplaceEnabled && (<>
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
          </>)}

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

          {marketplaceEnabled && (
          <Route
            path="/settings/payouts"
            element={
              <ProtectedRoute>
                <SettingsPayoutsPage />
              </ProtectedRoute>
            }
          />
          )}

          <Route path="/" element={<CollectorLandingPage />} />

          {/* Admin routes — protected by AdminProtectedRoute */}
          <Route path="/admin" element={<AdminProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:id" element={<AdminUserDetailPage />} />
              {marketplaceEnabled && <Route path="moderation" element={<AdminModerationPage />} />}
              {marketplaceEnabled && <Route path="auctions" element={<AdminAuctionsPage />} />}
              {marketplaceEnabled && <Route path="auctions/:id" element={<AdminAuctionDetailPage />} />}
              {/* S22: Yoti verifications admin surface. Static "verifications"
                  before parameterized ":userId" sibling (Lesson #5). Legacy
                  seller-verification doc-pipeline page remains accessible. */}
              <Route path="verifications" element={<AdminVerificationsPage />} />
              <Route path="verifications/:userId" element={<AdminVerificationDetailPage />} />
              {marketplaceEnabled && <Route path="seller-verification" element={<AdminSellerVerificationPage />} />}
              {marketplaceEnabled && <Route path="escrow" element={<AdminEscrowPage />} />}
              {/* S-ADMIN1: token admin console (manage_nfc enforced by the API). */}
              <Route path="tags" element={<AdminTagsPage />} />
              <Route path="tags/:tagId" element={<AdminTagDetailPage />} />
              <Route path="reissue-requests" element={<AdminReissuePage />} />
              <Route path="audit-logs" element={<AdminAuditLogPage />} />
              <Route path="health" element={<AdminHealthPage />} />
            </Route>
          </Route>

          {/* Catch-all: unknown paths → landing page */}
          <Route path="*" element={<NotFoundPage />} />
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
