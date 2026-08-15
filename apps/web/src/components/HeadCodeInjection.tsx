import React from "react";

interface HeadCodeInjectionProps {
  code?: string;
}

export function HeadCodeInjection({ code }: HeadCodeInjectionProps) {
  if (!code || !code.trim()) return null;

  const elements: React.ReactNode[] = [];

  // Matches HTML tags commonly injected in <head>: scripts, styles, meta, links, noscript
  const tagRegex =
    /<!--[\s\S]*?-->|<(script|style|noscript)([^>]*)>([\s\S]*?)<\/\1>|<(meta|link|base)([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tagRegex.exec(code)) !== null) {
    index++;
    const fullMatch = match[0];

    // Ignore comments
    if (fullMatch.startsWith("<!--")) {
      continue;
    }

    // Paired tags: <script>, <style>, <noscript>
    if (match[1]) {
      const tagName = match[1].toLowerCase();
      const rawAttrs = match[2] || "";
      const body = match[3] || "";
      const attrs = parseAttributes(rawAttrs);

      if (tagName === "script") {
        elements.push(
          <script
            key={`script-${index}`}
            {...attrs}
            dangerouslySetInnerHTML={body ? { __html: body } : undefined}
          />,
        );
      } else if (tagName === "style") {
        elements.push(
          <style
            key={`style-${index}`}
            {...attrs}
            dangerouslySetInnerHTML={{ __html: body }}
          />,
        );
      } else if (tagName === "noscript") {
        elements.push(
          <noscript
            key={`noscript-${index}`}
            {...attrs}
            dangerouslySetInnerHTML={{ __html: body }}
          />,
        );
      }
    }

    // Self-closing / void tags: <meta>, <link>, <base>
    if (match[4]) {
      const tagName = match[4].toLowerCase();
      const rawAttrs = match[5] || "";
      const attrs = parseAttributes(rawAttrs);

      if (tagName === "meta") {
        elements.push(<meta key={`meta-${index}`} {...attrs} />);
      } else if (tagName === "link") {
        elements.push(<link key={`link-${index}`} {...attrs} />);
      } else if (tagName === "base") {
        elements.push(<base key={`base-${index}`} {...attrs} />);
      }
    }
  }

  // Fallback if no tags matched
  if (elements.length === 0 && code.trim()) {
    if (code.includes("{") && code.includes("}")) {
      elements.push(
        <style
          key="fallback-style"
          dangerouslySetInnerHTML={{ __html: code }}
        />,
      );
    } else {
      elements.push(
        <script
          key="fallback-script"
          dangerouslySetInnerHTML={{ __html: code }}
        />,
      );
    }
  }

  return <>{elements}</>;
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const rawKey = match[1];
    if (!rawKey) continue;

    const value =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
          ? match[3]
          : match[4] !== undefined
            ? match[4]
            : "";

    const lower = rawKey.toLowerCase();
    const reactKey =
      lower === "class"
        ? "className"
        : lower === "httpequiv" || lower === "http-equiv"
          ? "httpEquiv"
          : lower === "charset"
            ? "charSet"
            : lower === "crossorigin"
              ? "crossOrigin"
              : rawKey;

    attrs[reactKey] = value;
  }

  return attrs;
}
