import { GlossaryTerm } from "./translation-types";

export class TranslationGlossary {
  private terms: Map<string, GlossaryTerm> = new Map();

  constructor(initialTerms: GlossaryTerm[] = []) {
    for (const term of initialTerms) {
      this.addTerm(term);
    }
  }

  addTerm(term: GlossaryTerm): void {
    const key = `${term.sourceLocale.toLowerCase()}:${term.targetLocale.toLowerCase()}:${term.sourceTerm.toLowerCase()}`;
    this.terms.set(key, term);
  }

  getTerms(sourceLocale: string, targetLocale: string): GlossaryTerm[] {
    const s = sourceLocale.split("-")[0]!.toLowerCase();
    const t = targetLocale.split("-")[0]!.toLowerCase();
    const result: GlossaryTerm[] = [];

    this.terms.forEach((term) => {
      const termS = term.sourceLocale.split("-")[0]!.toLowerCase();
      const termT = term.targetLocale.split("-")[0]!.toLowerCase();
      if (termS === s && termT === t) {
        result.push(term);
      }
    });
    return result;
  }

  /**
   * Generates a clear prompt instruction block for LLMs enforcing publication terminology.
   */
  buildGlossaryPromptInstructions(sourceLocale: string, targetLocale: string): string {
    const terms = this.getTerms(sourceLocale, targetLocale);
    if (terms.length === 0) return "";

    const lines = terms.map((term) => {
      const note = term.description ? ` (${term.description})` : "";
      return `- "${term.sourceTerm}" -> "${term.targetTerm}"${note}`;
    });

    return (
      `\n\n[MANDATORY TRANSLATION GLOSSARY]\n` +
      `You MUST strictly adhere to the following publication terminology mapping:\n` +
      lines.join("\n") +
      `\nDo NOT alter or translate these terms differently.\n`
    );
  }
}

// Baseline default publication glossary terms for English -> Arabic
export const defaultTranslationGlossary = new TranslationGlossary([
  { sourceTerm: "Vibress", targetTerm: "فايبرس", sourceLocale: "en", targetLocale: "ar", description: "Brand name" },
  { sourceTerm: "Workspace", targetTerm: "مساحة العمل", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Publication", targetTerm: "المنشور", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Post", targetTerm: "مقال", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Page", targetTerm: "صفحة", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Tag", targetTerm: "وسم", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Theme", targetTerm: "قالب", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Plugin", targetTerm: "إضافة", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Newsletter", targetTerm: "نشرة بريدية", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Draft", targetTerm: "مسودة", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Published", targetTerm: "منشور", sourceLocale: "en", targetLocale: "ar" },
  { sourceTerm: "Translation", targetTerm: "ترجمة", sourceLocale: "en", targetLocale: "ar" },
]);
