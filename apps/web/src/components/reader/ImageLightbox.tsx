"use client";

import React, { useEffect, useState } from "react";

export function ImageLightbox() {
  const [activeImage, setActiveImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  useEffect(() => {
    const handleImageClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG" && target.closest(".studio-html-content")) {
        // Skip linked images or small icons
        if (target.closest("a") || target.classList.contains("emoji")) return;
        const img = target as HTMLImageElement;
        setActiveImage({
          src: img.currentSrc || img.src,
          alt: img.alt || "",
        });
      }
    };

    const container = document.querySelector(".studio-html-content");
    if (container) {
      container.addEventListener("click", handleImageClick as EventListener);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (container) {
        container.removeEventListener(
          "click",
          handleImageClick as EventListener,
        );
      }
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!activeImage) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zoomed image"
      onClick={() => setActiveImage(null)}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.88)",
        backdropFilter: "blur(8px)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        cursor: "zoom-out",
        animation: "vbFadeIn 0.2s ease-out",
      }}
    >
      <img
        src={activeImage.src}
        alt={activeImage.alt}
        style={{
          maxWidth: "92vw",
          maxHeight: "92vh",
          objectFit: "contain",
          borderRadius: "8px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)",
          animation: "vbScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
      <button
        type="button"
        aria-label="Close zoomed image"
        onClick={() => setActiveImage(null)}
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          background: "rgba(255, 255, 255, 0.15)",
          border: "none",
          borderRadius: "50%",
          width: "40px",
          height: "40px",
          color: "#ffffff",
          fontSize: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}
