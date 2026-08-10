import React, { useState, useEffect } from 'react';
import { ApiUser } from '../lib/api';
import { PostsList } from './PostsList';
import { PostEditor } from './PostEditor';
import { PagesList } from './PagesList';
import { PageEditor } from './PageEditor';
import { TagsManager } from './TagsManager';
import { MediaLibrary } from './MediaLibrary';
import { StorageSettings } from './StorageSettings';
import { ThemesSettings } from './ThemesSettings';
import { MembersList } from './MembersList';
import { BillingSettings } from './BillingSettings';
import { SubscriptionsList } from './SubscriptionsList';
import { NewslettersSettings } from './NewslettersSettings';
import { CommunitySettings } from './CommunitySettings';
import { PlatformSettings } from './PlatformSettings';
import { IntelligenceSettings } from './IntelligenceSettings';
import { OperationsSettings } from './OperationsSettings';

import { AppSidebar } from './layout/sidebar/AppSidebar';
import { AnalyticsDashboard } from './layout/AnalyticsDashboard';

interface AdminShellProps {
  user: ApiUser;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  can: (permissionKey: string) => boolean;
}

export const AdminShell: React.FC<AdminShellProps> = ({
  user,
  currentPath,
  onNavigate,
  onLogout,
  can,
}) => {
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const canPublishPosts = can('posts.publish');
  const canPublishPages = can('pages.publish');

  // Route Views Renderer
  const renderContent = () => {
    if (currentPath === '/admin/posts' || currentPath === '/admin/posts/') {
      return <PostsList onNavigate={onNavigate} canPublish={canPublishPosts} />;
    }
    if (currentPath === '/admin/posts/drafts') {
      return <PostsList onNavigate={onNavigate} canPublish={canPublishPosts} filterStatus="draft" />;
    }
    if (currentPath === '/admin/posts/scheduled') {
      return <PostsList onNavigate={onNavigate} canPublish={canPublishPosts} filterStatus="scheduled" />;
    }
    if (currentPath === '/admin/posts/published') {
      return <PostsList onNavigate={onNavigate} canPublish={canPublishPosts} filterStatus="published" />;
    }
    if (currentPath === '/admin/posts/new') {
      return <PostEditor currentUserId={user.id} canPublish={canPublishPosts} onNavigate={onNavigate} />;
    }
    if (currentPath.startsWith('/admin/posts/')) {
      const postId = currentPath.split('/admin/posts/')[1];
      return <PostEditor postId={postId} currentUserId={user.id} canPublish={canPublishPosts} onNavigate={onNavigate} />;
    }

    if (currentPath === '/admin/pages' || currentPath === '/admin/pages/') {
      return <PagesList onNavigate={onNavigate} canPublish={canPublishPages} />;
    }
    if (currentPath === '/admin/pages/new') {
      return <PageEditor currentUserId={user.id} canPublish={canPublishPages} onNavigate={onNavigate} />;
    }
    if (currentPath.startsWith('/admin/pages/')) {
      const pageId = currentPath.split('/admin/pages/')[1];
      return <PageEditor pageId={pageId} currentUserId={user.id} canPublish={canPublishPages} onNavigate={onNavigate} />;
    }

    if (currentPath === '/admin/tags' || currentPath === '/admin/tags/') {
      return <TagsManager />;
    }

    if (currentPath === '/admin/media' || currentPath === '/admin/media/' || currentPath.startsWith('/admin/media/')) {
      return <MediaLibrary />;
    }

    if (currentPath === '/admin/settings/storage' || currentPath === '/admin/settings/storage/' || currentPath.startsWith('/admin/settings/storage')) {
      return <StorageSettings />;
    }

    if (currentPath === '/admin/settings/themes' || currentPath === '/admin/settings/themes/' || currentPath.startsWith('/admin/settings/themes')) {
      return <ThemesSettings />;
    }

    if (currentPath === '/admin/members' || currentPath === '/admin/members/' || currentPath.startsWith('/admin/members')) {
      return <MembersList />;
    }

    if (currentPath === '/admin/settings/billing' || currentPath === '/admin/settings/billing/' || currentPath.startsWith('/admin/settings/billing')) {
      return <BillingSettings />;
    }

    if (currentPath === '/admin/subscriptions' || currentPath === '/admin/subscriptions/' || currentPath.startsWith('/admin/subscriptions')) {
      return <SubscriptionsList />;
    }

    if (currentPath === '/admin/newsletters' || currentPath === '/admin/newsletters/' || currentPath.startsWith('/admin/newsletters')) {
      return <NewslettersSettings />;
    }

    if (currentPath === '/admin/community' || currentPath === '/admin/community/' || currentPath.startsWith('/admin/community')) {
      return <CommunitySettings />;
    }

    if (currentPath === '/admin/settings/platform' || currentPath === '/admin/settings/platform/' || currentPath.startsWith('/admin/settings/platform')) {
      return <PlatformSettings />;
    }

    if (currentPath === '/admin/analytics' || currentPath === '/admin/analytics/' || currentPath.startsWith('/admin/analytics')) {
      return <IntelligenceSettings />;
    }

    if (currentPath === '/admin/settings/operations' || currentPath === '/admin/settings/operations/' || currentPath.startsWith('/admin/settings/operations')) {
      return <OperationsSettings />;
    }

    // Default View: Analytics Dashboard
    return <AnalyticsDashboard user={user} />;
  };

  return (
    <div className="h-screen max-h-screen w-screen bg-background text-foreground flex overflow-hidden font-sans">
      {/* Vibress Modular Sidebar Assembly */}
      <AppSidebar
        user={user}
        currentPath={currentPath}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigate={onNavigate}
        onLogout={onLogout}
        canPublishPosts={canPublishPosts}
      />

      {/* Main View Area */}
      <main className="flex-1 h-full max-h-screen overflow-y-auto p-6 md:p-8">{renderContent()}</main>
    </div>
  );
};
