import type { ThemeExtensionViewModel } from "@vibress/theme-core";

/**
 * Every theme has a safe fallback. Plugin-provided values remain text nodes,
 * never HTML, CSS, URLs, or script instructions.
 */
export function DefaultExtensionView({ extension }: {
  extension: ThemeExtensionViewModel;
}) {
  return (
    <main id="main-content" aria-label={extension.title}
      dir={extension.direction}
      className="vibress-extension-view"
      style={{ maxWidth: "72rem", marginInline: "auto",
        padding: "clamp(1rem, 4vw, 3rem)" }}>
      <header style={{ marginBlockEnd: "2rem" }}>
        <h1 dir="auto">{extension.title}</h1>
      </header>
      <dl style={{ display: "grid", gap: "1rem" }}>
        {Object.entries(extension.data).map(([key, value]) => (
          <div key={key}>
            <dt dir="auto" style={{ fontWeight: 600 }}>{key}</dt>
            <dd dir="auto" style={{ overflowWrap: "anywhere", marginInlineStart: 0 }}>
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
