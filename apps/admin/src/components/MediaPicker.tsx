import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listMediaApi, uploadMediaApi, ApiMediaAsset } from '../lib/api';
import { X, Search, UploadCloud, CheckCircle2, Film, Music, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';

export interface MediaPickerProps {
  onSelectAsset?: (asset: ApiMediaAsset) => void;
  onSelectAssets?: (assets: ApiMediaAsset[]) => void;
  multiple?: boolean;
  allowedTypes?: Array<'image' | 'video' | 'audio' | 'file'>;
  onClose?: () => void;
}

export const MediaPicker: React.FC<MediaPickerProps> = ({
  onSelectAsset,
  onSelectAssets,
  multiple = false,
  allowedTypes,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>(allowedTypes?.[0] || 'all');
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);

  const filterType = selectedType === 'all' ? undefined : (selectedType as 'image' | 'video' | 'audio' | 'file');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['media', { search, assetType: filterType }],
    queryFn: () => listMediaApi({ search, assetType: filterType, limit: 50 }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadMediaApi(file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      setUploadError(null);
      if (!multiple && onSelectAsset) {
        onSelectAsset(res.media);
      }
    },
    onError: (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      setUploadError(e.message || 'Upload failed');
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        uploadMutation.mutate(file);
      }
    }
  };

  const toggleSelect = (asset: ApiMediaAsset) => {
    if (!multiple) {
      if (onSelectAsset) {
        onSelectAsset(asset);
      }
      return;
    }

    const next = new Set(selectedAssetIds);
    if (next.has(asset.id)) {
      next.delete(asset.id);
    } else {
      next.add(asset.id);
    }
    setSelectedAssetIds(next);
  };

  const handleConfirmMultiple = () => {
    if (!onSelectAssets || !data) return;
    const selectedList = data.items.filter((item) => selectedAssetIds.has(item.id));
    onSelectAssets(selectedList);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-md flex items-center justify-center z-[1000] p-4 animate-in fade-in duration-200">
      <div className="studio-glassy-modal bg-card/90 dark:bg-[#1a1c20]/95 backdrop-blur-2xl border border-border/80 dark:border-white/10 rounded-2xl w-[800px] max-w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-foreground transition-all">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-border/60 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Select Media Asset</h3>
              <p className="text-xs text-muted-foreground">Choose existing media or upload new files</p>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 dark:hover:bg-white/10 transition"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex justify-between items-center px-6 py-3 bg-muted/40 dark:bg-white/[0.02] border-b border-border/60 dark:border-white/10 gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search filename..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border/80 bg-background/80 dark:bg-white/[0.05] text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                aria-label="Search media"
              />
            </div>

            {!allowedTypes && (
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border/80 bg-background/80 dark:bg-white/[0.05] text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                aria-label="Filter by media type"
              >
                <option value="all">All Types</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="audio">Audio</option>
                <option value="file">Files</option>
              </select>
            )}
          </div>

          <label className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground font-medium rounded-lg text-xs hover:opacity-90 transition cursor-pointer shadow-sm">
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Upload File</span>
              </>
            )}
            <input
              type="file"
              onChange={handleFileChange}
              className="hidden"
              disabled={uploadMutation.isPending}
            />
          </label>
        </div>

        {uploadError && (
          <div className="px-6 py-2 bg-destructive/10 text-destructive text-xs border-b border-destructive/20 flex items-center justify-between">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="text-xs underline font-medium">Dismiss</button>
          </div>
        )}

        {/* Content grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-sm">Loading media assets...</span>
            </div>
          )}

          {isError && (
            <div className="py-12 text-center text-destructive text-sm">
              Failed to load media: {(error as Error).message}
            </div>
          )}

          {data && data.items.length === 0 && !isLoading && (
            <div className="py-16 flex flex-col items-center justify-center text-center gap-3 text-muted-foreground">
              <div className="w-12 h-12 rounded-2xl bg-muted/60 dark:bg-white/[0.04] flex items-center justify-center">
                <UploadCloud className="w-6 h-6 opacity-60" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No media assets found</p>
                <p className="text-xs text-muted-foreground mt-0.5">Upload images, videos or documents to use them here</p>
              </div>
            </div>
          )}

          {data && data.items.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {data.items.map((asset) => {
                const isSelected = selectedAssetIds.has(asset.id);
                return (
                  <div
                    key={asset.id}
                    onClick={() => toggleSelect(asset)}
                    className={`group relative rounded-xl overflow-hidden cursor-pointer border transition-all duration-200 ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                        : 'border-border/80 dark:border-white/10 bg-card dark:bg-white/[0.04] hover:border-primary/50 hover:shadow-md'
                    }`}
                  >
                    <div className="h-28 bg-muted/50 dark:bg-white/[0.03] flex items-center justify-center overflow-hidden relative">
                      {asset.assetType === 'image' ? (
                        <img
                          src={asset.url}
                          alt={asset.displayName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="text-muted-foreground flex items-center justify-center">
                          {asset.assetType === 'video' && <Film className="w-8 h-8 text-rose-500/80" />}
                          {asset.assetType === 'audio' && <Music className="w-8 h-8 text-amber-500/80" />}
                          {asset.assetType === 'file' && <FileText className="w-8 h-8 text-blue-500/80" />}
                        </div>
                      )}

                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-0.5 shadow">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    <div className="p-2.5">
                      <div
                        className="text-xs font-semibold text-foreground truncate"
                        title={asset.displayName}
                      >
                        {asset.displayName}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex justify-between items-center">
                        <span>{formatSize(asset.sizeBytes)}</span>
                        <span className="uppercase text-[10px] font-medium tracking-wider px-1.5 py-0.5 rounded bg-muted/70 dark:bg-white/[0.06]">
                          {asset.extension}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-border/60 dark:border-white/10 flex justify-between items-center bg-muted/30 dark:bg-white/[0.02]">
          <span className="text-xs text-muted-foreground">
            {multiple ? `${selectedAssetIds.size} item(s) selected` : 'Click an asset to insert it directly'}
          </span>

          {multiple && (
            <button
              onClick={handleConfirmMultiple}
              disabled={selectedAssetIds.size === 0}
              className="px-4 py-1.5 bg-primary text-primary-foreground font-medium rounded-lg text-xs hover:opacity-90 disabled:opacity-50 transition"
            >
              Select {selectedAssetIds.size} Asset(s)
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
