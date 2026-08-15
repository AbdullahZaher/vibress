"use client";

import React, { useEffect, useState } from "react";
import type { PublicTocItemDto } from "@vibress/api-contracts";

interface TableOfContentsProps {
  items?: PublicTocItemDto[];
}

export function TableOfContents({ items }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!items || items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      {
        rootMargin: "0px 0px -70% 0px",
        threshold: 0.1,
      },
    );

    const elements: HTMLElement[] = [];
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) {
        observer.observe(el);
        elements.push(el);
      }
    }

    return () => {
      for (const el of elements) {
        observer.unobserve(el);
      }
    };
  }, [items]);

  if (!items || items.length < 2) return null;

  return (
    <nav className="vb-toc-wrapper" aria-label="Table of Contents">
      <div className="vb-toc-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="vb-toc-title">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              display: "inline",
              marginRight: "6px",
              verticalAlign: "middle",
            }}
          >
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
          Table of Contents
        </span>
        <button
          type="button"
          className="vb-toc-toggle"
          aria-expanded={isOpen}
          aria-label="Toggle Table of Contents"
        >
          {isOpen ? "▲" : "▼"}
        </button>
      </div>

      <ul className={`vb-toc-list ${isOpen ? "is-open" : ""}`}>
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <li
              key={item.id}
              className={`vb-toc-item level-${item.level} ${isActive ? "is-active" : ""}`}
            >
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const target = document.getElementById(item.id);
                  if (target) {
                    target.scrollIntoView({ behavior: "smooth" });
                    window.history.pushState(null, "", `#${item.id}`);
                    setActiveId(item.id);
                    setIsOpen(false);
                  }
                }}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
