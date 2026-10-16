/**
 * Translate only explicit text leaves of versioned Studio JSON content.
 * IDs, URLs, media refs, marks, types and attributes are never sent to an AI
 * provider or overwritten by its response.
 */
export interface TextSegment { path: string; text: string }
export interface TranslationPayload {
  title: string;
  excerpt: string;
  segments: Record<string, string>;
}

export function collectTranslatableText(content: Record<string, unknown>): TextSegment[] {
  const segments: TextSegment[] = [];
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 40 || segments.length > 1200) {
      throw new Error("Translation document exceeds the supported limits");
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, path + "/" + index, depth + 1));
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const childPath = path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1");
        if (
          (key === "text" || key === "caption" || key === "alt") &&
          typeof child === "string" &&
          child.trim().length > 0
        ) {
          segments.push({ path: childPath, text: child });
        } else if (typeof child === "object" && child !== null) {
          visit(child, childPath, depth + 1);
        }
      }
    }
  };
  visit(content, "", 0);
  if (segments.reduce((sum, s) => sum + s.text.length, 0) > 80000) {
    throw new Error("Translation text exceeds the supported limits");
  }
  return segments;
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseStructuredTranslation(
  raw: string,
  segments: TextSegment[],
): TranslationPayload {
  const normalized = raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/, "").replace(/\s*\x60\x60\x60$/, "");
  const parsed: unknown = JSON.parse(normalized);
  if (!jsonObject(parsed) || typeof parsed.title !== "string" ||
      typeof parsed.excerpt !== "string" || !jsonObject(parsed.segments) ||
      parsed.title.trim().length === 0) {
    throw new Error("AI provider returned an invalid translation");
  }
  const required = new Set(segments.map((segment) => segment.path));
  const keys = Object.keys(parsed.segments);
  if (keys.length !== required.size ||
      keys.some((key) => !required.has(key) || typeof parsed.segments[key] !== "string" ||
      !(parsed.segments[key] as string).trim())) {
    throw new Error("AI provider omitted or altered translated document fields");
  }
  const values: Record<string, string> = {};
  for (const segment of segments) {
    const translated = parsed.segments[segment.path];
    if (typeof translated !== "string") {
      throw new Error("AI provider omitted a required text segment");
    }
    values[segment.path] = translated;
  }
  return { title: parsed.title, excerpt: parsed.excerpt, segments: values };
}

export function applyStructuredTranslation(
  content: Record<string, unknown>,
  translated: TranslationPayload,
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(content);
  for (const [path, text] of Object.entries(translated.segments)) {
    const components = path.split("/").slice(1).map((value) =>
      value.replace(/~1/g, "/").replace(/~0/g, "~"));
    let current: unknown = result;
    for (const part of components.slice(0, -1)) {
      if (Array.isArray(current) && /^\d+$/.test(part)) {
        current = current[Number(part)];
      } else if (jsonObject(current) && Object.hasOwn(current, part)) {
        current = current[part];
      } else {
        throw new Error("Malformed translation path");
      }
    }
    const final = components.at(-1);
    if (!final || !["text", "caption", "alt"].includes(final) ||
        !jsonObject(current) || typeof current[final] !== "string") {
      throw new Error("Translation attempted to change a non-translatable field");
    }
    current[final] = text;
  }
  return result;
}
