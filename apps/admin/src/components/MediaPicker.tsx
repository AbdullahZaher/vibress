import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listMediaApi, uploadMediaApi, ApiMediaAsset } from '../lib/api';

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
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Select Media Asset</h3>
          {onClose && (
            <button onClick={onClose} style={closeButtonStyle}>
              ✕
            </button>
          )}
        </div>

        <div style={toolbarStyle}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search filename..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />

            {!allowedTypes && (
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All Types</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="audio">Audio</option>
                <option value="file">Files</option>
              </select>
            )}
          </div>

          <label style={uploadButtonStyle}>
            {uploadMutation.isPending ? 'Uploading...' : '+ Upload File'}
            <input
              type="file"
              onChange={handleFileChange}
              style={{ display: 'none' }}
              disabled={uploadMutation.isPending}
            />
          </label>
        </div>

        {uploadError && <div style={errorBannerStyle}>{uploadError}</div>}

        <div style={contentStyle}>
          {isLoading && <div style={{ padding: '24px', textAlign: 'center' }}>Loading media items...</div>}
          {isError && (
            <div style={{ padding: '24px', color: '#dc2626', textAlign: 'center' }}>
              Failed to load media: {(error as Error).message}
            </div>
          )}

          {data && data.items.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>
              No media assets found. Upload one to get started!
            </div>
          )}

          {data && data.items.length > 0 && (
            <div style={gridStyle}>
              {data.items.map((asset) => {
                const isSelected = selectedAssetIds.has(asset.id);
                return (
                  <div
                    key={asset.id}
                    onClick={() => toggleSelect(asset)}
                    style={{
                      ...cardStyle,
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    }}
                  >
                    <div style={previewBoxStyle}>
                      {asset.assetType === 'image' ? (
                        <img
                          src={asset.url}
                          alt={asset.displayName}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={iconPlaceholderStyle}>
                          {asset.assetType === 'video' && '🎥'}
                          {asset.assetType === 'audio' && '🎵'}
                          {asset.assetType === 'file' && '📄'}
                        </div>
                      )}
                    </div>

                    <div style={{ padding: '8px' }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#111827',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={asset.displayName}
                      >
                        {asset.displayName}
                      </div>
                      <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                        {formatSize(asset.sizeBytes)} • {asset.extension.toUpperCase()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          {multiple ? (
            <button
              onClick={handleConfirmMultiple}
              disabled={selectedAssetIds.size === 0}
              style={confirmButtonStyle}
            >
              Select {selectedAssetIds.size} Asset(s)
            </button>
          ) : (
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Click an asset to select it</div>
          )}
        </div>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  width: '760px',
  maxWidth: '90vw',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 24px',
  borderBottom: '1px solid #e5e7eb',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  fontSize: '18px',
  cursor: 'pointer',
  color: '#6b7280',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 24px',
  backgroundColor: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  fontSize: '13px',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  fontSize: '13px',
};

const uploadButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};

const errorBannerStyle: React.CSSProperties = {
  padding: '8px 24px',
  backgroundColor: '#fef2f2',
  color: '#dc2626',
  fontSize: '12px',
  borderBottom: '1px solid #fecaca',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '24px',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
  gap: '16px',
};

const cardStyle: React.CSSProperties = {
  borderRadius: '8px',
  overflow: 'hidden',
  cursor: 'pointer',
  backgroundColor: '#ffffff',
  transition: 'all 0.15s ease',
};

const previewBoxStyle: React.CSSProperties = {
  height: '100px',
  backgroundColor: '#f3f4f6',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
};

const iconPlaceholderStyle: React.CSSProperties = {
  fontSize: '32px',
};

const footerStyle: React.CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid #e5e7eb',
  display: 'flex',
  justifyContent: 'flex-end',
  backgroundColor: '#f9fafb',
};

const confirmButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
};
