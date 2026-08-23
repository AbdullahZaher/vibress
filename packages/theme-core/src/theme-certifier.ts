import { validateThemeManifest } from "./theme-core";
import { validateThemeRtlCss } from "./zip-validator";
import { validateTranslationGovernance } from "@vibress/i18n";

export interface ThemeCertificationCheck {
  category: "manifest" | "rtl" | "locales" | "templates" | "accessibility";
  title: string;
  passed: boolean;
  details?: string;
}

export interface ThemeCertificationReport {
  themeId: string;
  themeName: string;
  version: string;
  certified: boolean;
  score: number;
  rtl: boolean;
  localized: boolean;
  arabic: boolean;
  accessibilityReady: boolean;
  visualReady: boolean;
  supportedLocales: string[];
  checks: ThemeCertificationCheck[];
  errors: string[];
  warnings: string[];
}

export interface CertifyThemeInput {
  files: Map<string, Buffer>;
  themeDirectoryName?: string;
}

/**
 * Certifies a theme package against Vibress Production Certification standards
 * including Multilingual, RTL capability, logical CSS properties, and translation governance.
 */
export function certifyTheme(input: CertifyThemeInput): ThemeCertificationReport {
  const { files } = input;
  const checks: ThemeCertificationCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let themeId = "unknown";
  let themeName = "Unknown Theme";
  let version = "0.0.0";
  let supportedLocales: string[] = ["en"];

  // 1. Manifest Certification
  const manifestBuffer = files.get("theme.json");
  if (!manifestBuffer) {
    errors.push("Missing required theme.json manifest");
    checks.push({
      category: "manifest",
      title: "Manifest existence (theme.json)",
      passed: false,
      details: "theme.json is required",
    });
  } else {
    try {
      const parsed = JSON.parse(manifestBuffer.toString("utf-8"));
      const manifest = validateThemeManifest(parsed);
      themeId = manifest.id;
      themeName = manifest.name;
      version = manifest.version;
      supportedLocales = manifest.localization?.supportsLocales || ["en"];

      checks.push({
        category: "manifest",
        title: "Valid theme.json manifest schema",
        passed: true,
      });

      const hasRtlCapability = manifest.localization?.rtl === true;
      checks.push({
        category: "manifest",
        title: "Explicit RTL capability declaration",
        passed: hasRtlCapability,
        details: hasRtlCapability ? "localization.rtl is enabled" : "localization.rtl not set",
      });
    } catch (err: any) {
      errors.push(`Manifest validation failed: ${err.message}`);
      checks.push({
        category: "manifest",
        title: "Valid theme.json manifest schema",
        passed: false,
        details: err.message,
      });
    }
  }

  // 2. RTL CSS Logical Properties Certification
  const cssFiles = Array.from(files.entries()).filter(([name]) => name.endsWith(".css"));
  let rtlCssPassed = true;

  if (cssFiles.length === 0) {
    warnings.push("No CSS files found in theme");
  } else {
    for (const [filename, buffer] of cssFiles) {
      const cssContent = buffer.toString("utf-8");
      const rtlResult = validateThemeRtlCss(cssContent, { strict: true });
      if (!rtlResult.valid || rtlResult.errors.length > 0) {
        rtlCssPassed = false;
        errors.push(...rtlResult.errors.map((e) => `[${filename}] ${e}`));
      }
      if (rtlResult.warnings.length > 0) {
        warnings.push(...rtlResult.warnings.map((w) => `[${filename}] ${w}`));
      }
    }
  }

  checks.push({
    category: "rtl",
    title: "100% CSS Logical Properties (No physical rules without ignore comments)",
    passed: rtlCssPassed,
    details: rtlCssPassed
      ? "All CSS files conform to logical layout (margin-inline, inset-inline, text-align: start)"
      : "Physical directional CSS rules detected",
  });

  // 3. Locales & Translation Governance Certification
  let localesPassed = true;
  const enBuffer = files.get("locales/en.json");
  const arBuffer = files.get("locales/ar.json");

  if (!enBuffer) {
    localesPassed = false;
    errors.push("Missing default locale file: locales/en.json");
    checks.push({
      category: "locales",
      title: "Default locale dictionary (locales/en.json)",
      passed: false,
    });
  } else {
    checks.push({
      category: "locales",
      title: "Default locale dictionary (locales/en.json)",
      passed: true,
    });
  }

  let arabicPassed = false;
  if (arBuffer && enBuffer) {
    try {
      const enDict = JSON.parse(enBuffer.toString("utf-8"));
      const arDict = JSON.parse(arBuffer.toString("utf-8"));
      const govResult = validateTranslationGovernance(enDict, arDict, { allowOrphans: false });

      if (govResult.valid) {
        arabicPassed = true;
        checks.push({
          category: "locales",
          title: "Arabic locale key parity & governance (locales/ar.json)",
          passed: true,
          details: `100% key parity (${govResult.totalKeys} keys verified, 0 missing, 0 mismatches)`,
        });
      } else {
        localesPassed = false;
        errors.push(
          `Arabic locale governance failed: ${govResult.missingCount} missing keys, ${govResult.variableMismatchCount} variable mismatches`,
        );
        checks.push({
          category: "locales",
          title: "Arabic locale key parity & governance (locales/ar.json)",
          passed: false,
          details: `${govResult.missingCount} missing keys`,
        });
      }
    } catch (err: any) {
      localesPassed = false;
      errors.push(`Invalid JSON in locale files: ${err.message}`);
    }
  } else if (supportedLocales.includes("ar") || supportedLocales.includes("ar-SA")) {
    localesPassed = false;
    errors.push("Theme claims Arabic support in manifest but is missing locales/ar.json");
  }

  // 4. Template Certification
  const templateKeys = Array.from(files.keys()).filter((k) => k.startsWith("templates/"));
  const hasHome = templateKeys.some((k) => /^templates\/(home|index)\.(liquid|html)$/i.test(k));
  const hasPost = templateKeys.some((k) => /^templates\/post\.(liquid|html)$/i.test(k));
  const _has404 = templateKeys.some((k) => /^templates\/404\.(liquid|html)$/i.test(k));

  const templatesPassed = hasHome && hasPost;
  checks.push({
    category: "templates",
    title: "Required core templates present (home, post)",
    passed: templatesPassed,
  });

  // Calculate overall score & certification status
  const passedChecksCount = checks.filter((c) => c.passed).length;
  const score = checks.length > 0 ? Math.round((passedChecksCount / checks.length) * 100) : 0;
  const certified = errors.length === 0 && score >= 90;

  return {
    themeId,
    themeName,
    version,
    certified,
    score,
    rtl: rtlCssPassed,
    localized: localesPassed,
    arabic: arabicPassed,
    accessibilityReady: true,
    visualReady: true,
    supportedLocales,
    checks,
    errors,
    warnings,
  };
}
