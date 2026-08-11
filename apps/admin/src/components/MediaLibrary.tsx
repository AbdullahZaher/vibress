import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listMediaApi,
  uploadMediaApi,
  updateMediaApi,
  deleteMediaApi,
  getMediaReferencesApi,
  ApiMediaAsset,
  ApiMediaReferenceSummary,
} from '../lib/api';

import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { Video, Music, FileText, Upload, Trash2, CheckCircle2, Copy, Search } from 'lucide-react';

export const MediaLibrary: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Detail Modal
  const [selectedAsset, setSelectedAsset] = useState<ApiMediaAsset | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // References Query
  const { data: refSummaryData, isLoading: isLoadingRefs } = useQuery<{ summary: ApiMediaReferenceSummary }>({
    queryKey: ['media-references', selectedAsset?.id],
    queryFn: () => getMediaReferencesApi(selectedAsset!.id),
    enabled: !!selectedAsset,
  });

  const filterType = selectedType === 'all' ? undefined : (selectedType as 'image' | 'video' | 'audio' | 'file');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['media', { search, assetType: filterType }],
    queryFn: () => listMediaApi({ search, assetType: filterType, limit: 100 }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadMediaApi(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      setUploadError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setUploadError(e.message || 'Upload failed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      updateMediaApi(id, { displayName }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      setSelectedAsset(res.media);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMediaApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      setSelectedAsset(null);
      setDeleteError(null);
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setDeleteError(e.message || 'Delete failed');
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      uploadMutation.mutate(file);
    });
  };

  const handleCopyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openDetail = (asset: ApiMediaAsset) => {
    setSelectedAsset(asset);
    setDisplayNameDraft(asset.displayName);
  };

  const handleSaveDisplayName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset) return;
    updateMutation.mutate({ id: selectedAsset.id, displayName: displayNameDraft });
  };

  const assets = data?.items || [];

  return (
    <div className="space-y-8 w-full max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Media Asset Library</h1>

        <label className="inline-flex items-center justify-center rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 cursor-pointer gap-2 shadow-2xs shrink-0">
          <Upload className="h-4 w-4" /> Upload Files
          <input type="file" multiple onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      {uploadError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {uploadError}
        </div>
      )}

      {deleteError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
          {deleteError}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          {['all', 'image', 'video', 'audio', 'file'].map((type) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-all cursor-pointer ${
                selectedType === type
                  ? 'bg-card text-foreground border border-border shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {type === 'all' ? 'All Media' : `${type}s`}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Filter assets by filename..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs bg-card border-border"
          />
        </div>
      </div>

      {/* Content Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground text-xs gap-2">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading media library...
        </div>
      ) : isError ? (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
          Failed to load assets: {(error as Error)?.message}
        </div>
      ) : assets.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground space-y-2 bg-transparent border-border shadow-2xs">
          <p className="text-xs font-medium text-foreground">No media assets found</p>
          <p className="text-xs text-muted-foreground">Upload images, audio, or video files to populate library.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {assets.map((asset: ApiMediaAsset) => (
            <div
              key={asset.id}
              onClick={() => openDetail(asset)}
              className="group relative rounded-xl border border-border bg-card overflow-hidden cursor-pointer hover:border-sidebar-border shadow-2xs transition-all flex flex-col"
            >
              <div className="aspect-square bg-muted/40 flex items-center justify-center relative overflow-hidden">
                {asset.assetType === 'image' ? (
                  <img src={asset.url} alt={asset.displayName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : asset.assetType === 'video' ? (
                  <Video className="h-8 w-8 text-muted-foreground" />
                ) : asset.assetType === 'audio' ? (
                  <Music className="h-8 w-8 text-muted-foreground" />
                ) : (
                  <FileText className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="p-2 space-y-0.5 border-t border-border">
                <p className="text-xs font-semibold text-foreground truncate">{asset.displayName}</p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {(asset.sizeBytes / 1024).toFixed(0)} KB
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Asset Detail Modal */}
      <Dialog isOpen={!!selectedAsset} onClose={() => setSelectedAsset(null)} title="Asset Preview & Details">
        {selectedAsset && (
          <div className="space-y-4 pt-2">
            <div className="aspect-video rounded-lg bg-neutral-950 border border-border overflow-hidden flex items-center justify-center">
              {selectedAsset.assetType === 'image' ? (
                <img src={selectedAsset.url} alt={selectedAsset.displayName} className="max-h-full object-contain" />
              ) : selectedAsset.assetType === 'video' ? (
                <video src={selectedAsset.url} controls className="max-h-full" />
              ) : selectedAsset.assetType === 'audio' ? (
                <audio src={selectedAsset.url} controls className="w-full px-4" />
              ) : (
                <div className="text-center space-y-2">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
                  <p className="text-xs font-mono text-muted-foreground">{selectedAsset.originalFilename}</p>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveDisplayName} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Display Name</label>
                <Input
                  type="text"
                  value={displayNameDraft}
                  onChange={(e) => setDisplayNameDraft(e.target.value)}
                  className="h-8 text-xs bg-card border-border"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Direct URL</label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={selectedAsset.url} className="h-8 text-xs font-mono bg-muted/40 border-border" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyUrl(selectedAsset.url, selectedAsset.id)}
                    className="h-8 text-xs shrink-0 border-border bg-card hover:bg-accent"
                  >
                    {copiedId === selectedAsset.id ? <CheckCircle2 className="h-4 w-4 text-foreground" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Usage References */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1 text-xs">
                <p className="font-semibold text-foreground">Usage References:</p>
                {isLoadingRefs ? (
                  <p className="text-muted-foreground">Checking references...</p>
                ) : refSummaryData?.summary ? (
                  <p className="text-muted-foreground font-mono">
                    Used in {refSummaryData.summary.totalReferences} location(s)
                  </p>
                ) : (
                  <p className="text-muted-foreground font-mono">No usage recorded</p>
                )}
              </div>

              <div className="flex justify-between items-center pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(selectedAsset.id)}
                  className="text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 gap-1"
                >
                  <Trash2 className="h-4 w-4" /> Delete Asset
                </Button>

                <Button type="submit" size="sm" className="text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        )}
      </Dialog>
    </div>
  );
};
