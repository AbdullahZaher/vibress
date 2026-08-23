import { flattenDictionary } from "./translation-governance";

export interface LocaleCoverageSummary {
  locale: string;
  totalKeys: number;
  translatedKeys: number;
  missingKeys: number;
  coveragePercentage: number;
  byNamespace: Record<
    string,
    {
      total: number;
      translated: number;
      missing: number;
      percentage: number;
    }
  >;
}

export interface FullCoverageReport {
  generatedAt: string;
  sourceLocale: string;
  totalSourceKeys: number;
  locales: Record<string, LocaleCoverageSummary>;
  overallCoveragePercentage: number;
}

/**
 * Computes coverage percentage and namespace breakdowns for a set of target locale dictionaries
 * relative to a base source dictionary (default: English).
 */
export function generateTranslationCoverageReport(
  sourceDict: Record<string, unknown>,
  targetDictsByLocale: Record<string, Record<string, unknown>>,
  sourceLocale = "en-US",
): FullCoverageReport {
  const flatSource = flattenDictionary(sourceDict);
  const sourceKeys = Object.keys(flatSource);
  const totalSourceKeys = sourceKeys.length;

  const locales: Record<string, LocaleCoverageSummary> = {};
  let totalPercentSum = 0;
  const localeCodes = Object.keys(targetDictsByLocale);

  for (const [localeCode, targetDict] of Object.entries(targetDictsByLocale)) {
    const flatTarget = flattenDictionary(targetDict);
    let translatedCount = 0;
    let missingCount = 0;

    const byNamespace: Record<
      string,
      { total: number; translated: number; missing: number; percentage: number }
    > = {};

    for (const key of sourceKeys) {
      const ns = key.includes(".") ? key.split(".")[0]! : "common";
      if (!byNamespace[ns]) {
        byNamespace[ns] = { total: 0, translated: 0, missing: 0, percentage: 0 };
      }
      byNamespace[ns]!.total++;

      if (key in flatTarget && flatTarget[key] && flatTarget[key]!.trim() !== "") {
        translatedCount++;
        byNamespace[ns]!.translated++;
      } else {
        missingCount++;
        byNamespace[ns]!.missing++;
      }
    }

    for (const ns of Object.keys(byNamespace)) {
      const data = byNamespace[ns]!;
      data.percentage = data.total > 0 ? Math.round((data.translated / data.total) * 100) : 100;
    }

    const coveragePercentage =
      totalSourceKeys > 0 ? Math.round((translatedCount / totalSourceKeys) * 100) : 100;

    totalPercentSum += coveragePercentage;

    locales[localeCode] = {
      locale: localeCode,
      totalKeys: totalSourceKeys,
      translatedKeys: translatedCount,
      missingKeys: missingCount,
      coveragePercentage,
      byNamespace,
    };
  }

  const overallCoveragePercentage =
    localeCodes.length > 0 ? Math.round(totalPercentSum / localeCodes.length) : 100;

  return {
    generatedAt: new Date().toISOString(),
    sourceLocale,
    totalSourceKeys,
    locales,
    overallCoveragePercentage,
  };
}

/**
 * Formats a FullCoverageReport as a human-readable Markdown table.
 */
export function formatCoverageReportAsMarkdown(report: FullCoverageReport): string {
  const lines: string[] = [
    `# Translation Coverage Report`,
    `Generated at: ${report.generatedAt}`,
    `Source Locale: \`${report.sourceLocale}\` (${report.totalSourceKeys} total keys)`,
    `Overall Coverage: **${report.overallCoveragePercentage}%**`,
    ``,
    `| Locale | Total Keys | Translated | Missing | Coverage |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const [code, summary] of Object.entries(report.locales)) {
    lines.push(
      `| \`${code}\` | ${summary.totalKeys} | ${summary.translatedKeys} | ${summary.missingKeys} | **${summary.coveragePercentage}%** |`,
    );
  }

  lines.push(``, `## Namespace Breakdown`);
  for (const [code, summary] of Object.entries(report.locales)) {
    lines.push(``, `### Locale: \`${code}\``, ``, `| Namespace | Total | Translated | Missing | Coverage |`, `| :--- | :--- | :--- | :--- | :--- |`);
    for (const [ns, data] of Object.entries(summary.byNamespace)) {
      lines.push(`| \`${ns}\` | ${data.total} | ${data.translated} | ${data.missing} | ${data.percentage}% |`);
    }
  }

  return lines.join("\n");
}
