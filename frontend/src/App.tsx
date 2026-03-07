import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuth } from './features/auth/hooks/useAuth';
import { LoginPage } from './features/auth/pages/LoginPage';
import { SignupPage } from './features/auth/pages/SignupPage';
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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<SignupPage />} />
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

          <Route path="/" element={<Navigate to="/my-listings" replace />} />

          {/* Admin routes — protected by AdminProtectedRoute */}
          <Route path="/admin" element={<AdminProtectedRoute />}>
            <Route element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:id" element={<AdminUserDetailPage />} />
              <Route path="moderation" element={<AdminModerationPage />} />
              <Route path="audit-logs" element={<AdminAuditLogPage />} />
              <Route path="health" element={<AdminHealthPage />} />
            </Route>
          </Route>
        </Routes>
        
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
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
