import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { LoginPage } from '../components/LoginPage';
import { AdminShell } from '../components/AdminShell';

const queryClient = new QueryClient();

const AppContent: React.FC = () => {
  const { user, isLoading, isAuthenticated, login, logout, can } = useAuth();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

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

  // If authenticated and on /admin/login, redirect to /admin
  if (currentPath === '/admin/login' || currentPath === '/admin/login/') {
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
