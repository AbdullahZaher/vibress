import React, { useRef } from 'react';
import { ImageIcon, Video, Images, File as FileIcon, Headphones, Upload, LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  image: ImageIcon,
  gallery: Images,
  video: Video,
  audio: Headphones,
  file: FileIcon,
};

interface CardPlaceholderProps {
  iconType: 'image' | 'gallery' | 'video' | 'audio' | 'file';
  title: string;
  description: string;
  onFileSelect: (files: File[]) => void;
  multiple?: boolean;
  isSelected?: boolean;
  uploading?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function CardPlaceholder({ 
  iconType, title, description, onFileSelect, multiple = false, isSelected = false, uploading = false, onClick
}: CardPlaceholderProps) {
  const Icon = ICONS[iconType] || ImageIcon;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(Array.from(e.target.files));
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) onClick(e);
  };

  const handleContainerClick = () => {
    fileInputRef.current?.click();
  };

  const accept = 
    iconType === 'image' || iconType === 'gallery' ? 'image/*' : 
    iconType === 'video' ? 'video/*' : 
    iconType === 'audio' ? 'audio/*' : 
    '*/*';

  return (
    <div 
      className={`group relative my-3 rounded-xl border border-dashed transition-all duration-200 cursor-pointer select-none overflow-hidden ${
        isSelected
          ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
          : 'border-border/80 dark:border-white/10 hover:border-primary/60 bg-muted/30 dark:bg-white/[0.02] hover:bg-muted/60 dark:hover:bg-white/[0.04]'
      }`}
      onClick={handleClick}
    >
      <div 
        className="flex items-center justify-between p-3.5 px-4.5 gap-4"
        onClick={handleContainerClick}
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-sm">
            <Icon className="w-5 h-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground tracking-tight">{title}</span>
              {uploading && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium animate-pulse">
                  Uploading...
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {uploading ? 'Processing file upload...' : description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-background dark:bg-white/[0.06] border border-border/80 dark:border-white/10 text-foreground group-hover:border-primary/40 group-hover:text-primary transition-all shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload {title}</span>
          </button>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept={accept}
        multiple={multiple}
      />
    </div>
  );
}
