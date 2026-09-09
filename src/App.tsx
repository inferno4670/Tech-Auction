import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { FullPageLoader } from './components/ui';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import AdminLayout from './components/layout/AdminLayout';
import TeamLayout from './components/layout/TeamLayout';

// Pages
import LandingPage from './pages/LandingPage';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import TeamLoginPage from './pages/team/TeamLoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminTeams from './pages/admin/AdminTeams';
import AdminAuctions from './pages/admin/AdminAuctions';
import AdminLiveControl from './pages/admin/AdminLiveControl';
import AdminLeaderboard from './pages/admin/AdminLeaderboard';
import AdminLogs from './pages/admin/AdminLogs';
import AdminSettings from './pages/admin/AdminSettings';
import TeamDashboard from './pages/team/TeamDashboard';
import DisplayPage from './pages/display/DisplayPage';

// ─── Auth Guards ─────────────────────────────────────────────────────────────

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <FullPageLoader text="Verifying access..." />;    if (!profile || profile.role !== 'admin') return <Navigate to="/admin/login" replace />;
  return <AdminLayout>{children}</AdminLayout>;
}

function TeamRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <FullPageLoader text="Verifying access..." />;    if (!profile || profile.role !== 'team') return <Navigate to="/team/login" replace />;
  return <TeamLayout>{children}</TeamLayout>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  // If logged in, redirect to appropriate dashboard
  if (profile) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/team'} replace />;
  }
  return <>{children}</>;
}

// ─── App ─────────────────────────────────────────────────────────────────────

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />
      <Route path="/admin/login" element={<PublicRoute><AdminLoginPage /></PublicRoute>} />
      <Route path="/team/login" element={<PublicRoute><TeamLoginPage /></PublicRoute>} />

      {/* Display (public, no auth required) */}
      <Route path="/display" element={<DisplayPage />} />

      {/* Admin */}
      <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      <Route path="/admin/teams" element={<AdminRoute><AdminTeams /></AdminRoute>} />
      <Route path="/admin/auctions" element={<AdminRoute><AdminAuctions /></AdminRoute>} />
      <Route path="/admin/live" element={<AdminRoute><AdminLiveControl /></AdminRoute>} />
      <Route path="/admin/leaderboard" element={<AdminRoute><AdminLeaderboard /></AdminRoute>} />
      <Route path="/admin/logs" element={<AdminRoute><AdminLogs /></AdminRoute>} />
      <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />

      {/* Team */}
      <Route path="/team" element={<TeamRoute><TeamDashboard /></TeamRoute>} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#1a1a2e',
              color: '#e2e8f0',
              border: '1px solid rgba(34, 211, 238, 0.2)',
              borderRadius: '12px',
              fontFamily: 'monospace',
              fontSize: '14px',
            },
          }}
        />
        <ErrorBoundary fallbackTitle="Team Dashboard Error">
          <AppRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}
