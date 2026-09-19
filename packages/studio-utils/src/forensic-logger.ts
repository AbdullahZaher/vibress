export function hashString(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function countWordsInText(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function extractDocStats(doc: any): { childCount: number; wordCount: number; hash: string } {
  if (!doc || !doc.root) {
    return { childCount: 0, wordCount: 0, hash: "empty" };
  }
  const children = doc.root.children || [];
  const childCount = children.length;
  
  // Extract all text content
  const extractText = (node: any): string => {
    if (!node) return "";
    let t = node.text || "";
    if (node.children && Array.isArray(node.children)) {
      t += " " + node.children.map(extractText).join(" ");
    }
    return t;
  };
  
  const text = extractText(doc.root);
  const wordCount = countWordsInText(text);
  const jsonStr = JSON.stringify(doc);
  const hash = hashString(jsonStr);
  return { childCount, wordCount, hash };
}

export function logForensicEvent(stage: string, data: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  console.log(`[FORENSIC] ${timestamp} ${stage}`, JSON.stringify({
    timestamp,
    stage,
    ...data,
  }));
}
