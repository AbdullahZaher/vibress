import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  X,
  Loader2,
  AlertCircle,
  ExternalLink,
  Camera,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  fetchUnsplashStatus,
  searchUnsplashApi,
  selectUnsplashPhotoApi,
  UnsplashPhoto,
  UnsplashSelectResponse,
} from "../../lib/api/unsplash";

export interface UnsplashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPhoto: (result: UnsplashSelectResponse["media"]) => void;
}

export const UnsplashModal: React.FC<UnsplashModalProps> = ({
  isOpen,
  onClose,
  onSelectPhoto,
}) => {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalPhotos, setTotalPhotos] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSelecting, setIsSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const prevFocusedElementRef = useRef<HTMLElement | null>(null);

  // Check Unsplash status on open
  useEffect(() => {
    if (!isOpen) return;

    prevFocusedElementRef.current = document.activeElement as HTMLElement;

    fetchUnsplashStatus()
      .then((status) => {
        setConfigured(status.configured);
      })
      .catch(() => {
        setConfigured(false);
      });

    return () => {
      if (prevFocusedElementRef.current) {
        prevFocusedElementRef.current.focus();
      }
    };
  }, [isOpen]);

  // Initial popular search or focus
  useEffect(() => {
    if (isOpen && configured) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);

      // If empty query on initial load, provide initial curated search
      if (!query.trim()) {
        setQuery("minimal editorial");
      }
    }
  }, [isOpen, configured]);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  // Execute search when debouncedQuery changes
  const performSearch = useCallback(async (q: string, p: number = 1, append: boolean = false) => {
    if (!q) {
      setPhotos([]);
      setTotalPages(0);
      setTotalPhotos(0);
      return;
    }

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const res = await searchUnsplashApi(q, p, 24);
      if (append) {
        setPhotos((prev) => [...prev, ...(res.results || [])]);
      } else {
        setPhotos(res.results || []);
      }
      setPage(res.page || p);
      setTotalPages(res.totalPages || 0);
      setTotalPhotos(res.total || 0);
    } catch (err: any) {
      setError(err?.message || "Failed to search Unsplash photos");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || configured !== true) return;
    if (debouncedQuery) {
      performSearch(debouncedQuery, 1, false);
    }
  }, [debouncedQuery, isOpen, configured, performSearch]);

  // Handle photo selection
  const handleSelect = async (photo: UnsplashPhoto) => {
    if (isSelecting) return;
    setIsSelecting(photo.id);
    setError(null);

    try {
      const res = await selectUnsplashPhotoApi(photo.id);
      onSelectPhoto(res.media);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to import selected photo from Unsplash");
    } finally {
      setIsSelecting(null);
    }
  };

  // Keyboard navigation & ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unsplash Photo Library"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                Unsplash Photo Library
                <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  Free
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                High-resolution photography curated from Unsplash
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unconfigured State Banner */}
        {configured === false && (
          <div className="p-8 text-center flex flex-col items-center justify-center max-w-lg mx-auto my-auto">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold mb-2 text-foreground">
              Unsplash Integration Not Configured
            </h3>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              To browse and insert high-resolution Unsplash photography directly into your posts, configure your Unsplash API Access Key in your environment variables.
            </p>
            <div className="p-3 bg-muted/60 rounded-xl font-mono text-xs text-foreground/80 mb-6 w-full select-all">
              UNSPLASH_ACCESS_KEY=your_access_key_here
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("https://unsplash.com/developers", "_blank")}
                className="gap-1.5"
              >
                <span>Get Unsplash API Key</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
              <Button variant="secondary" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}

        {/* Configured State */}
        {configured === true && (
          <>
            {/* Search Input Bar */}
            <div className="p-4 border-b border-border/40 bg-card">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search millions of high-resolution photos..."
                  aria-label="Search Unsplash"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-muted-foreground/60"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Results Grid Container */}
            <div className="flex-1 overflow-y-auto p-6 min-h-[380px] max-h-[58vh]">
              {isLoading && photos.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-3">
                  <Loader2 className="w-7 h-7 animate-spin text-primary" />
                  <span className="text-sm">Searching Unsplash...</span>
                </div>
              ) : photos.length === 0 && !isLoading ? (
                <div className="h-64 flex flex-col items-center justify-center text-center text-muted-foreground p-6">
                  <Camera className="w-10 h-10 stroke-1 opacity-40 mb-2" />
                  <p className="text-sm font-medium text-foreground">No photos found</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Try searching for something else like &quot;architecture&quot;, &quot;minimal&quot;, or &quot;nature&quot;
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {photos.map((photo) => {
                      const selectingThis = isSelecting === photo.id;
                      return (
                        <div
                          key={photo.id}
                          className="group relative rounded-xl overflow-hidden border border-border/40 bg-muted/20 aspect-[16/10] shadow-sm hover:shadow-md transition-all focus-within:ring-2 focus-within:ring-primary"
                        >
                          <img
                            src={photo.urls.small}
                            alt={photo.altDescription || photo.description || "Unsplash photo"}
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />

                          {/* Hover Gradient Overlay */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex flex-col justify-between p-3">
                            <div className="flex justify-end">
                              <a
                                href={photo.links.html}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View on Unsplash"
                                aria-label={`View photo by ${photo.user.name} on Unsplash`}
                                className="p-1 rounded-md bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {photo.user.profileImage && (
                                  <img
                                    src={photo.user.profileImage}
                                    alt={photo.user.name}
                                    className="w-5 h-5 rounded-full object-cover shrink-0"
                                  />
                                )}
                                <span className="text-xs font-medium text-white truncate drop-shadow-sm">
                                  {photo.user.name}
                                </span>
                              </div>

                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(isSelecting)}
                                onClick={() => handleSelect(photo)}
                                className="h-7 text-xs px-2.5 font-medium shrink-0 bg-white/95 text-neutral-900 hover:bg-white shadow"
                              >
                                {selectingThis ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                    <span>Importing...</span>
                                  </>
                                ) : (
                                  <span>Select</span>
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* Busy State Overlay */}
                          {selectingThis && (
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center text-white gap-2">
                              <Loader2 className="w-6 h-6 animate-spin text-white" />
                              <span className="text-xs font-medium tracking-wide">Importing photo...</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Load More Button */}
                  {page < totalPages && (
                    <div className="mt-8 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isLoadingMore}
                        onClick={() => performSearch(debouncedQuery, page + 1, true)}
                        className="px-6 rounded-xl"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Loading more...
                          </>
                        ) : (
                          `Load more photos (${photos.length} of ${totalPhotos})`
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer Attribution Note */}
            <div className="px-6 py-3 border-t border-border/40 bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Photos provided by <a href="https://unsplash.com/?utm_source=vibress&utm_medium=referral" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Unsplash</a></span>
              <span>Attribution is automatically preserved</span>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};
