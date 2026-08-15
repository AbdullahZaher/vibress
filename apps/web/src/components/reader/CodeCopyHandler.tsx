"use client";

import { useEffect } from "react";

export function CodeCopyHandler() {
  useEffect(() => {
    const handleCopy = async (btn: HTMLButtonElement) => {
      const codeBlock = btn.closest(".studio-code-block");
      if (!codeBlock) return;

      const codeElement = codeBlock.querySelector("code");
      if (!codeElement) return;

      const text = codeElement.innerText || codeElement.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.textContent;
        btn.textContent = "Copied! ✓";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = originalText || "Copy";
          btn.classList.remove("copied");
        }, 2000);
      } catch (err) {
        console.error("Failed to copy text: ", err);
      }
    };

    const buttons = document.querySelectorAll<HTMLButtonElement>(
      ".studio-code-copy-btn",
    );
    const listeners: Array<{ btn: HTMLButtonElement; handler: () => void }> =
      [];

    buttons.forEach((btn) => {
      const handler = () => handleCopy(btn);
      btn.addEventListener("click", handler);
      listeners.push({ btn, handler });
    });

    return () => {
      listeners.forEach(({ btn, handler }) => {
        btn.removeEventListener("click", handler);
      });
    };
  }, []);

  return null;
}
