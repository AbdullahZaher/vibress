import React, { useRef } from 'react';
import { ImageIcon, Video, Images, File as FileIcon, Headphones } from 'lucide-react';

const ICONS: Record<string, React.FC<any>> = {
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
  onClick?: (e: React.MouseEvent) => void;
}

export function CardPlaceholder({ 
  iconType, title, description, onFileSelect, multiple = false, isSelected = false, onClick
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
      className="relative flex flex-col items-center justify-center p-12 my-4 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer group" 
      onClick={handleClick}
      style={{ outline: isSelected ? '2px solid #3b82f6' : 'none' }}
    >
      <div className="flex flex-col items-center justify-center w-full h-full" onClick={handleContainerClick}>
        <Icon className="w-12 h-12 text-gray-400 group-hover:text-blue-500 transition-colors mb-4" strokeWidth={1.5} />
        <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
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
