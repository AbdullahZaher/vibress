import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiRequest, ApiMediaAsset } from '../lib/api';
import { VibressStudio } from '@vibress/studio-react';
import { StudioDocument, migrateDocument, createEmptyStudioDocument } from '@vibress/studio-core';
import { MediaPicker } from './MediaPicker';

import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog } from './ui/dialog';
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertCircle,
  Clock,
  Settings
} from 'lucide-react';
import { PostSettingsSidebar } from './editor/PostSettingsSidebar';

interface PostEditorProps {
  postId?: string | undefined;
  currentUserId: string;
  canPublish: boolean;
  onNavigate: (path: string) => void;
}

interface Tag {
  id: string;
  name: string;
}

interface Revision {
  id: string;
  revisionNumber: number;
  title: string;
  createdAt: string;
}

type AutosaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

export const PostEditor: React.FC<PostEditorProps> = ({
  postId,
  currentUserId,
  canPublish,
  onNavigate,
}) => {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [studioDoc, setStudioDoc] = useState<StudioDocument>(createEmptyStudioDocument());
  const [status, setStatus] = useState('draft');
  const [version, setVersion] = useState(1);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [scheduledAtStr, setScheduledAtStr] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasUnsavedChangesRef = useRef(false);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerConfig, setPickerConfig] = useState<{
    cardType: string;
    resolve: (payload: Record<string, unknown> | null) => void;
  } | null>(null);

  const handleRequestMedia = useCallback((req: { cardType: string }) => {
    return new Promise<Record<string, unknown> | null>((resolve) => {
      setPickerConfig({ cardType: req.cardType, resolve });
      setShowPicker(true);
    });
  }, []);

  const handlePickerSelectAsset = (asset: ApiMediaAsset) => {
    if (!pickerConfig) return;
    let payload: Record<string, unknown> = {};
    if (pickerConfig.cardType === 'image') {
      payload = { assetId: asset.id, src: asset.url, alt: asset.displayName, width: asset.width || undefined, height: asset.height || undefined };
    } else if (pickerConfig.cardType === 'video') {
      payload = { assetId: asset.id, src: asset.url, caption: asset.displayName };
    } else if (pickerConfig.cardType === 'audio') {
      payload = { assetId: asset.id, src: asset.url, title: asset.displayName };
    } else if (pickerConfig.cardType === 'file') {
      payload = { assetId: asset.id, src: asset.url, fileName: asset.originalFilename, fileSize: `${asset.sizeBytes}` };
    }
    pickerConfig.resolve(payload);
    setShowPicker(false);
    setPickerConfig(null);
  };

  const handlePickerSelectAssets = (assets: ApiMediaAsset[]) => {
    if (!pickerConfig) return;
    const payload = {
      images: assets.map((a) => ({ assetId: a.id, src: a.url, alt: a.displayName })),
    };
    pickerConfig.resolve(payload);
    setShowPicker(false);
    setPickerConfig(null);
  };

  const handlePickerClose = () => {
    if (pickerConfig) {
      pickerConfig.resolve(null);
    }
    setShowPicker(false);
    setPickerConfig(null);
  };

  useEffect(() => {
    const fetchAllTags = async () => {
      try {
        const res = await apiRequest<{ tags: Tag[] }>('/tags');
        setAllTags(res.tags || []);
      } catch (err) {
        console.error('Failed to load tags', err);
      }
    };
    fetchAllTags();
  }, []);

  useEffect(() => {
    if (!postId) return;
    const fetchPost = async () => {
      setLoading(true);
      try {
        const res = await apiRequest<{ post: any }>(`/posts/${postId}`);
        const p = res.post;
        setTitle(p.title || '');
        setSlug(p.slug || '');
        setExcerpt(p.excerpt || '');
        setMetaTitle(p.metaTitle || '');
        setMetaDescription(p.metaDescription || '');
        setCanonicalUrl(p.canonicalUrl || '');
        setStatus(p.status || 'draft');
        setVersion(p.version || 1);
        if (p.scheduledAt) {
          const d = new Date(p.scheduledAt);
          setScheduledAtStr(d.toISOString().slice(0, 16));
        }

        if (p.tags) {
          setSelectedTagIds(p.tags.map((t: Tag) => t.id));
        }

        if (p.content || p.contentJson) {
          setStudioDoc(migrateDocument(p.content || p.contentJson));
        }
      } catch (err: any) {
        if (err.path && Array.isArray(err.path) && err.path.length > 0) {
          setErrorMsg(`${err.path.join('.')}: ${err.message}`);
        } else {
          setErrorMsg(err.message || 'Failed to load post');
        }
      } finally {
        setLoading(false);
      }
    };

    const fetchRevisions = async () => {
      try {
        const res = await apiRequest<{ revisions: Revision[] }>(`/posts/${postId}/revisions`);
        setRevisions(res.revisions || []);
      } catch (err) {
        console.error('Failed to load revisions', err);
      }
    };

    fetchPost();
    fetchRevisions();
  }, [postId]);

  const performAutosave = useCallback(async () => {
    if (!postId || !hasUnsavedChangesRef.current) return;

    setAutosaveState('saving');
    try {
      const payload = {
        title,
        slug: slug || undefined,
        excerpt: excerpt || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        canonicalUrl: canonicalUrl || null,
        content: studioDoc,
        tagIds: selectedTagIds,
        expectedVersion: version,
      };

      const res = await apiRequest<{ post: any }>(`/posts/${postId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setVersion(res.post.version);
      setAutosaveState('saved');
      hasUnsavedChangesRef.current = false;
    } catch (err: any) {
      if (err.status === 409 || err.message?.includes('Version conflict')) {
        setAutosaveState('conflict');
        setErrorMsg('Autosave conflict: Post was modified elsewhere. Please refresh.');
      } else {
        setAutosaveState('failed');
      }
    }
  }, [postId, title, slug, excerpt, metaTitle, metaDescription, canonicalUrl, studioDoc, selectedTagIds, version]);

  const triggerAutosaveDebounced = useCallback(() => {
    hasUnsavedChangesRef.current = true;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      performAutosave();
    }, 2000);
  }, [performAutosave]);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    const generatedSlug = generateSlug(val);
    // Auto-generate slug if it's currently empty or matches the old title's slug
    if (!slug || slug === generateSlug(title)) {
      setSlug(generatedSlug);
      
      // Auto-generate canonicalUrl if it's currently empty
      if (!canonicalUrl) {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'https://vibress.com';
        setCanonicalUrl(`${origin}/${generatedSlug}`);
      }
    }
    triggerAutosaveDebounced();
  };

  const handleDocChange = (doc: StudioDocument) => {
    setStudioDoc(doc);
    triggerAutosaveDebounced();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    try {
      const payload = {
        title,
        slug: slug || undefined,
        excerpt: excerpt || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        canonicalUrl: canonicalUrl || null,
        content: studioDoc,
        tagIds: selectedTagIds,
        expectedVersion: postId ? version : undefined,
      };

      if (postId) {
        const res = await apiRequest<{ post: any }>(`/posts/${postId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setVersion(res.post.version);
        setAutosaveState('saved');
        hasUnsavedChangesRef.current = false;
      } else {
        const res = await apiRequest<{ post: any }>('/posts', {
          method: 'POST',
          body: JSON.stringify({ ...payload, primaryAuthorId: currentUserId, authorIds: [currentUserId] }),
        });
        onNavigate(`/admin/posts/${res.post.id}`);
      }
    } catch (err: any) {
      if (err.path && Array.isArray(err.path) && err.path.length > 0) {
        setErrorMsg(`${err.path.join('.')}: ${err.message}`);
      } else {
        setErrorMsg(err.message || 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!postId || !canPublish) return;
    try {
      await apiRequest(`/posts/${postId}/publish`, { method: 'POST' });
      setStatus('published');
    } catch (err: any) {
      setErrorMsg(err.message || 'Publish failed');
    }
  };

  const handleUnpublish = async () => {
    if (!postId || !canPublish) return;
    try {
      await apiRequest(`/posts/${postId}/unpublish`, { method: 'POST' });
      setStatus('draft');
    } catch (err: any) {
      setErrorMsg(err.message || 'Unpublish failed');
    }
  };

  const handleSchedule = async () => {
    if (!postId || !canPublish || !scheduledAtStr) return;
    try {
      const scheduledAt = new Date(scheduledAtStr).toISOString();
      await apiRequest(`/posts/${postId}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt }),
      });
      setStatus('scheduled');
    } catch (err: any) {
      setErrorMsg(err.message || 'Schedule failed');
    }
  };

  const handleRestoreRevision = async (revisionId: string) => {
    if (!postId) return;
    if (!confirm('Restore this revision? Unsaved changes will be overwritten.')) return;
    try {
      const res = await apiRequest<{ post: any }>(`/posts/${postId}/revisions/${revisionId}/restore`, {
        method: 'POST',
      });
      const p = res.post;
      setTitle(p.title || '');
      setStudioDoc(migrateDocument(p.content || p.contentJson));
      setVersion(p.version);
      alert('Revision restored successfully');
    } catch (err: any) {
      setErrorMsg(err.message || 'Restore revision failed');
    }
  };

  const renderAutosaveStatus = () => {
    if (!postId) return null;
    switch (autosaveState) {
      case 'saving':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 animate-spin" /> Saving...
          </span>
        );
      case 'saved':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-foreground font-mono font-medium">
            <CheckCircle2 className="h-3 w-3" /> Saved to cloud
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-foreground font-mono font-medium">
            <AlertCircle className="h-3 w-3" /> Save failed
          </span>
        );
      case 'conflict':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
            <AlertCircle className="h-3 w-3" /> Version conflict
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>Loading article editor...</span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-[calc(100vh-theme(spacing.16))] w-full bg-background -mt-4">
      {/* Editor Header Bar */}
      <header className="flex items-center justify-between gap-4 px-6 py-4 shrink-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('/admin/posts')}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Posts
          </Button>
          <div className="h-4 w-[1px] bg-border" />
          <Badge
            variant={status === 'published' ? 'success' : status === 'scheduled' ? 'warning' : 'secondary'}
          >
            {status.toUpperCase()}
          </Badge>
          {renderAutosaveStatus()}
        </div>

        <div className="flex items-center gap-2">
          {postId && canPublish && (
            <>
              {status === 'published' ? (
                <Button variant="outline" size="sm" onClick={handleUnpublish} className="text-xs">
                  Unpublish
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePublish}
                  className="text-xs font-semibold"
                >
                  Publish Now
                </Button>
              )}
            </>
          )}

          <Button
            onClick={handleSave}
            disabled={saving || autosaveState === 'conflict'}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs gap-1.5 shadow-sm"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : postId ? 'Update' : 'Save Draft'}
          </Button>
          
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowSettings(true)} 
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Main Canvas */}
      <main className="flex-1 overflow-y-auto px-6 py-12 pb-32">
        <div className="max-w-[740px] mx-auto space-y-8">
          {errorMsg && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
              {errorMsg}
            </div>
          )}

          <textarea
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Post Title"
            aria-label="Post Title"
            className="w-full text-5xl font-bold bg-transparent border-none outline-none resize-none overflow-hidden focus:ring-0 placeholder:text-muted-foreground/30 leading-tight p-0"
            rows={1}
            onInput={(e) => {
              e.currentTarget.style.height = 'auto';
              e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
            }}
          />

          <VibressStudio
            value={studioDoc}
            onChange={handleDocChange}
            requestMedia={handleRequestMedia}
          />
        </div>
      </main>

      <PostSettingsSidebar 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        slug={slug} setSlug={setSlug}
        excerpt={excerpt} setExcerpt={setExcerpt}
        metaTitle={metaTitle} setMetaTitle={setMetaTitle}
        metaDescription={metaDescription} setMetaDescription={setMetaDescription}
        canonicalUrl={canonicalUrl} setCanonicalUrl={setCanonicalUrl}
        allTags={allTags}
        selectedTagIds={selectedTagIds} setSelectedTagIds={setSelectedTagIds}
        scheduledAtStr={scheduledAtStr} setScheduledAtStr={setScheduledAtStr}
        handleSchedule={handleSchedule}
        canPublish={canPublish}
        postId={postId || ''}
        revisions={revisions}
        handleRestoreRevision={handleRestoreRevision}
      />

      {/* Media Picker Modal Host */}
      <Dialog isOpen={showPicker} onClose={handlePickerClose} title="Select Media Asset">
        <MediaPicker
          allowedTypes={pickerConfig?.cardType === 'gallery' ? ['image'] : [pickerConfig?.cardType as any]}
          multiple={pickerConfig?.cardType === 'gallery'}
          onSelectAsset={handlePickerSelectAsset}
          onSelectAssets={handlePickerSelectAssets}
          onClose={handlePickerClose}
        />
      </Dialog>
    </div>
  );
};
