import { describe, it, expect } from "vitest";
import {
  validateTranslationGovernance,
  extractInterpolationVariables,
  flattenDictionary,
  generateTranslationCoverageReport,
  formatCoverageReportAsMarkdown,
  enDictionary,
  arDictionary,
} from "../index";

describe("Translation Governance & Key Integrity", () => {
  it("extracts interpolation variables accurately", () => {
    expect(extractInterpolationVariables("Hello {name}, you have {count} items")).toEqual([
      "count",
      "name",
    ]);
    expect(extractInterpolationVariables("No placeholders")).toEqual([]);
  });

  it("flattens nested dictionaries correctly", () => {
    const nested = {
      common: {
        save: "Save",
        actions: {
          cancel: "Cancel",
        },
      },
    };
    const flat = flattenDictionary(nested);
    expect(flat).toEqual({
      "common.save": "Save",
      "common.actions.cancel": "Cancel",
    });
  });

  it("detects missing keys, empty values, and variable mismatches", () => {
    const source = {
      common: {
        save: "Save {item}",
        cancel: "Cancel",
        delete: "Delete",
      },
    };

    const targetWithErrors = {
      common: {
        save: "حفظ", // Missing {item} variable
        cancel: "", // Empty
        // delete is completely missing
        extraKey: "إضافي", // Orphaned
      },
    };

    const result = validateTranslationGovernance(source, targetWithErrors);
    expect(result.valid).toBe(false);
    expect(result.missingCount).toBe(1); // common.delete
    expect(result.emptyCount).toBe(1); // common.cancel
    expect(result.variableMismatchCount).toBe(1); // common.save missing {item}
    expect(result.orphanedCount).toBe(1); // common.extraKey
  });

  it("passes 100% key parity and governance on core enDictionary vs arDictionary", () => {
    const result = validateTranslationGovernance(enDictionary, arDictionary, {
      allowOrphans: false,
    });
    expect(result.missingCount).toBe(0);
    expect(result.emptyCount).toBe(0);
    expect(result.variableMismatchCount).toBe(0);
    expect(result.valid).toBe(true);
  });
});

describe("Translation Coverage Reporter", () => {
  it("calculates accurate coverage percentages across locales and namespaces", () => {
    const source = {
      ui: {
        save: "Save",
        cancel: "Cancel",
      },
      emails: {
        welcome: "Welcome",
        confirm: "Confirm",
      },
    };

    const targetAr = {
      ui: {
        save: "حفظ",
        cancel: "إلغاء",
      },
      emails: {
        welcome: "أهلاً بك",
        confirm: "تأكيد",
      },
    };

    const targetFrPartial = {
      ui: {
        save: "Enregistrer",
      },
      emails: {
        welcome: "Bienvenue",
      },
    };

    const report = generateTranslationCoverageReport(source, {
      "ar-SA": targetAr,
      "fr-FR": targetFrPartial,
    });

    expect(report.totalSourceKeys).toBe(4);
    expect(report.locales["ar-SA"]!.coveragePercentage).toBe(100);
    expect(report.locales["ar-SA"]!.translatedKeys).toBe(4);
    expect(report.locales["ar-SA"]!.missingKeys).toBe(0);

    expect(report.locales["fr-FR"]!.coveragePercentage).toBe(50);
    expect(report.locales["fr-FR"]!.translatedKeys).toBe(2);
    expect(report.locales["fr-FR"]!.missingKeys).toBe(2);

    const md = formatCoverageReportAsMarkdown(report);
    expect(md).toContain("# Translation Coverage Report");
    expect(md).toContain("`ar-SA`");
    expect(md).toContain("100%");
    expect(md).toContain("`fr-FR`");
    expect(md).toContain("50%");
  });
});
