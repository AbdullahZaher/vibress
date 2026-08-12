import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { LoginPage } from '../components/LoginPage';
import { AdminShell } from '../components/AdminShell';
import { SetupWizard } from '../features/setup/SetupWizard';
import { fetchSetupStatus } from '../features/setup/lib';

const queryClient = new QueryClient();

type SetupState = 'loading' | 'uninstalled' | 'installed' | 'error';

const AppContent: React.FC = () => {
  const { user, isLoading, isAuthenticated, login, logout, can } = useAuth();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [setupState, setSetupState] = useState<SetupState>('loading');
  const [setupRetry, setSetupRetry] = useState(0);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSetupStatus()
      .then((status) => {
        if (!cancelled) setSetupState(status.installed ? 'installed' : 'uninstalled');
      })
      .catch(() => {
        if (!cancelled) setSetupState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [setupRetry]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // Installation-state gate runs BEFORE the authentication gate.
  if (setupState === 'loading') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div>Loading…</div>
      </div>
    );
  }

  if (setupState === 'error') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>Can't reach the Vibress API. Is it running?</p>
          <button
            type="button"
            onClick={() => setSetupRetry((n) => n + 1)}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #888', cursor: 'pointer', background: 'transparent' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Fresh instance: show the first-run wizard regardless of auth state.
  if (setupState === 'uninstalled') {
    if (currentPath !== '/admin/setup' && currentPath !== '/admin/setup/') {
      window.history.replaceState({}, '', '/admin/setup');
    }
    return (
      <SetupWizard
        onComplete={async () => {
          // The server set the staff session cookie; refetch auth state so the
          // owner enters Admin without a manual sign-in.
          await queryClient.invalidateQueries({ queryKey: ['auth'] });
          setSetupState('installed');
          navigate('/admin');
        }}
      />
    );
  }

  // Installed instance: normal authentication flow.
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div>Loading auth status...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    if (currentPath !== '/admin/login' && currentPath !== '/admin/login/') {
      window.history.replaceState({}, '', '/admin/login');
    }
    return (
      <LoginPage
        loginFn={async (email, password) => { await login(email, password); }}
        onLoginSuccess={() => navigate('/admin')}
      />
    );
  }

  // If authenticated and on /admin/login or the setup route, redirect to /admin
  if (currentPath === '/admin/login' || currentPath === '/admin/login/' || currentPath === '/admin/setup' || currentPath === '/admin/setup/') {
    window.history.replaceState({}, '', '/admin');
  }

  return (
    <AdminShell
      user={user!}
      currentPath={currentPath}
      onNavigate={navigate}
      onLogout={async () => {
        await logout();
        navigate('/admin/login');
      }}
      can={can}
    />
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};
