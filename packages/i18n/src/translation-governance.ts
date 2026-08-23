export interface GovernanceIssue {
  type: "missing" | "orphaned" | "variable_mismatch" | "plural_mismatch" | "empty";
  key: string;
  message: string;
  expected?: string;
  received?: string;
}

export interface GovernanceResult {
  valid: boolean;
  totalKeys: number;
  missingCount: number;
  orphanedCount: number;
  variableMismatchCount: number;
  emptyCount: number;
  issues: GovernanceIssue[];
}

/**
 * Extracts interpolation placeholders like {name}, {count}, {{value}} from a message string.
 */
export function extractInterpolationVariables(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/[{}]/g, "").trim()))).sort();
}

/**
 * Flattens nested JSON dictionaries to dot-delimited key-value pairs.
 */
export function flattenDictionary(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenDictionary(value as Record<string, unknown>, fullKey));
    } else if (typeof value === "string") {
      result[fullKey] = value;
    } else if (value !== null && value !== undefined) {
      result[fullKey] = String(value);
    }
  }
  return result;
}

/**
 * Validates a target translation dictionary against a source dictionary (e.g. English base).
 */
export function validateTranslationGovernance(
  sourceDict: Record<string, unknown>,
  targetDict: Record<string, unknown>,
  options?: { allowOrphans?: boolean; allowEmpty?: boolean },
): GovernanceResult {
  const flatSource = flattenDictionary(sourceDict);
  const flatTarget = flattenDictionary(targetDict);

  const issues: GovernanceIssue[] = [];
  const sourceKeys = Object.keys(flatSource);
  const targetKeys = Object.keys(flatTarget);

  let missingCount = 0;
  let orphanedCount = 0;
  let variableMismatchCount = 0;
  let emptyCount = 0;

  // 1. Check for missing keys in target
  for (const key of sourceKeys) {
    if (!(key in flatTarget)) {
      missingCount++;
      issues.push({
        type: "missing",
        key,
        message: `Missing translation key in target dictionary: '${key}'`,
      });
      continue;
    }

    const sourceVal = flatSource[key] || "";
    const targetVal = flatTarget[key] || "";

    if (!options?.allowEmpty && targetVal.trim() === "") {
      emptyCount++;
      issues.push({
        type: "empty",
        key,
        message: `Empty translation string for key: '${key}'`,
      });
    }

    // 2. Validate interpolation variables
    const sourceVars = extractInterpolationVariables(sourceVal);
    const targetVars = extractInterpolationVariables(targetVal);

    const missingVars = sourceVars.filter((v) => !targetVars.includes(v));
    const extraVars = targetVars.filter((v) => !sourceVars.includes(v));

    if (missingVars.length > 0 || extraVars.length > 0) {
      variableMismatchCount++;
      issues.push({
        type: "variable_mismatch",
        key,
        message: `Variable mismatch for key '${key}': expected [${sourceVars.join(", ")}], received [${targetVars.join(", ")}]`,
        expected: sourceVars.join(", "),
        received: targetVars.join(", "),
      });
    }
  }

  // 3. Check for orphaned keys in target
  if (!options?.allowOrphans) {
    for (const key of targetKeys) {
      if (!(key in flatSource)) {
        orphanedCount++;
        issues.push({
          type: "orphaned",
          key,
          message: `Orphaned translation key not present in source dictionary: '${key}'`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    totalKeys: sourceKeys.length,
    missingCount,
    orphanedCount,
    variableMismatchCount,
    emptyCount,
    issues,
  };
}
