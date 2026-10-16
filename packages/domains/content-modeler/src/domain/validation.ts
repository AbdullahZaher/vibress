import { ContentFieldDefinition } from "./types";

// Legacy stored model definitions can hold validation constraints under `validation`.
// These are still enforced by entry validation and must be considered in schema diffs.
type FieldWithLegacyValidation = ContentFieldDefinition & {
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
};

// Keep administrator-defined patterns bounded. This is a conservative guard
// against malformed and common super-linear expressions, not a full regex engine.
const MAX_FIELD_PATTERN_LENGTH = 256;

function validateFieldPattern(pattern: unknown): string | null {
  if (pattern === undefined || pattern === "") return null;
  if (typeof pattern !== "string") return "Field pattern must be a string.";
  if (pattern.length > MAX_FIELD_PATTERN_LENGTH) {
    return "Field pattern must be at most 256 characters.";
  }
  try {
    new RegExp(pattern);
  } catch {
    return "Field pattern is not a valid regular expression.";
  }
  // Backreferences and lookarounds can cause expensive, ambiguous matching.
  if (/\\(?:[1-9]|k<)|\(\?(?:[=!]|<[=!])/.test(pattern)) {
    return "Field pattern uses unsupported advanced expressions.";
  }

  // Repeated groups containing alternatives or more repetition can exhibit
  // catastrophic backtracking, e.g. (a+)+ or (a|aa)+.
  const groups: Array<{ repetition: boolean; alternation: boolean }> = [
    { repetition: false, alternation: false },
  ];
  let escaped = false;
  let inClass = false;
  const isQuantifierAt = (index: number): boolean => {
    const token = pattern[index];
    return token === "*" || token === "+" || token === "?" ||
      (token === "{" && /^\{\d+(?:,\d*)?\}/.test(pattern.slice(index)));
  };
  for (let i = 0; i < pattern.length; i++) {
    const token = pattern[i];
    if (escaped) { escaped = false; continue; }
    if (token === "\\") { escaped = true; continue; }
    if (inClass) { if (token === "]") inClass = false; continue; }
    if (token === "[") { inClass = true; continue; }
    if (token === "(") {
      groups.push({ repetition: false, alternation: false });
      continue;
    }
    if (token === ")") {
      const child = groups.pop();
      const parent = groups[groups.length - 1];
      if (!child || !parent) return "Field pattern is not a valid regular expression.";
      const repeated = isQuantifierAt(i + 1);
      if (repeated && (child.repetition || child.alternation)) {
        return "Field pattern contains unsafe nested or repeated alternatives.";
      }
      parent.repetition ||= child.repetition || repeated;
      continue;
    }
    const current = groups[groups.length - 1];
    if (!current) return "Field pattern is not a valid regular expression.";
    if (token === "|") current.alternation = true;
    if (token === "*" || token === "+" ||
        (token === "?" && pattern[i - 1] !== "(") ||
        (token === "{" && isQuantifierAt(i))) {
      current.repetition = true;
    }
  }
  return null;
}

export interface FieldValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

export class ValidationError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super(`Validation failed for fields: ${Object.keys(fieldErrors).join(", ")}`);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class ConcurrencyConflictError extends Error {
  readonly currentVersion: number;
  readonly expectedVersion: number;

  constructor(message: string, currentVersion: number, expectedVersion: number) {
    super(message);
    this.name = "ConcurrencyConflictError";
    this.currentVersion = currentVersion;
    this.expectedVersion = expectedVersion;
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export const RESERVED_FIELD_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export const MAX_FIELDS_PER_MODEL = 100;
export const MAX_DATA_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
export const MAX_RELATION_EXPANSION_DEPTH = 2;
export const MAX_RELATION_LIST_ITEMS = 100;

export const VALID_FIELD_TYPES = [
  "short_text",
  "text",
  "long_text",
  "rich_text",
  "studio_doc",
  "number",
  "boolean",
  "date",
  "datetime",
  "url",
  "email",
  "select",
  "multi_select",
  "taxonomy",
  "relation",
  "relation_list",
  "media",
  "json",
] as const;

export function validateModelDefinition(input: {
  name: string;
  slug?: string | undefined;
  fields?: FieldWithLegacyValidation[] | undefined;
}): void {
  if (!input.name || !input.name.trim()) {
    throw new ValidationError({ name: "Model name is required" });
  }

  const fields = input.fields || [];
  if (fields.length > MAX_FIELDS_PER_MODEL) {
    throw new ValidationError({
      fields: `A model cannot exceed ${MAX_FIELDS_PER_MODEL} fields.`,
    });
  }

  const seenKeys = new Set<string>();
  for (const field of fields) {
    if (!field.key || !field.key.trim()) {
      throw new ValidationError({
        [field.id || "field"]: "Each field must have a valid non-empty 'key'",
      });
    }
    const key = field.key.trim();
    if (RESERVED_FIELD_KEYS.has(key)) {
      throw new ValidationError({
        [key]: `Field key '${key}' is reserved and cannot be used.`,
      });
    }
    if (seenKeys.has(key)) {
      throw new ValidationError({
        [key]: `Duplicate field key '${key}' in content model.`,
      });
    }
    seenKeys.add(key);

    const patternIssue = validateFieldPattern(field.pattern ?? field.validation?.pattern);
    if (patternIssue) {
      throw new ValidationError({ [key]: patternIssue });
    }

    if (field.type && !(VALID_FIELD_TYPES as readonly string[]).includes(field.type)) {
      throw new ValidationError({
        [key]: `Invalid field type '${field.type}'. Must be one of: ${VALID_FIELD_TYPES.join(", ")}`,
      });
    }
  }
}

export function validateEntryData(
  data: Record<string, unknown>,
  fieldDefs: FieldWithLegacyValidation[],
): void {
  const jsonStr = JSON.stringify(data);
  if (jsonStr.length > MAX_DATA_PAYLOAD_BYTES) {
    throw new ValidationError({
      _payload: "Data payload exceeds maximum allowed size (1 MB)",
    });
  }

  const errors: Record<string, string> = {};

  for (const field of fieldDefs) {
    const val = data[field.key];

    // Check required
    if (field.required && (val === undefined || val === null || val === "")) {
      errors[field.key] = `Field '${field.name}' is required.`;
      continue;
    }

    if (val === undefined || val === null) {
      continue;
    }

    const min = field.min ?? field.validation?.min;
    const max = field.max ?? field.validation?.max;
    const minLength = field.minLength ?? field.validation?.minLength;
    const maxLength = field.maxLength ?? field.validation?.maxLength;
    const pattern = field.pattern ?? field.validation?.pattern;
    const patternIssue = validateFieldPattern(pattern);
    if (patternIssue) {
      errors[field.key] = patternIssue;
      continue;
    }

    // Type validation
    switch (field.type) {
      case "number":
        if (typeof val !== "number" || isNaN(val)) {
          errors[field.key] = `Field '${field.name}' must be a valid number.`;
        } else {
          if (min !== undefined && val < min) {
            errors[field.key] = `Field '${field.name}' must have minimum value ${min}.`;
          }
          if (max !== undefined && val > max) {
            errors[field.key] = `Field '${field.name}' must have maximum value ${max}.`;
          }
        }
        break;

      case "boolean":
        if (typeof val !== "boolean") {
          errors[field.key] = `Field '${field.name}' must be a boolean.`;
        }
        break;

      case "text":
      case "short_text":
      case "long_text":
      case "rich_text":
      case "studio_doc":
        if (field.type === "studio_doc" && typeof val === "object" && val !== null) {
          // studio_doc can be serialized AST / JSON
          break;
        }
        if (field.localizable && typeof val === "object" && val !== null && !Array.isArray(val)) {
          const dict = val as Record<string, unknown>;
          for (const [locKey, locVal] of Object.entries(dict)) {
            if (typeof locVal !== "string") {
              errors[field.key] = `Localized value for '${locKey}' in '${field.name}' must be a string.`;
            } else {
              if (minLength !== undefined && locVal.length < minLength) {
                errors[field.key] = `Field '${field.name}' (${locKey}) must be at least ${minLength} characters.`;
              }
              if (maxLength !== undefined && locVal.length > maxLength) {
                errors[field.key] = `Field '${field.name}' (${locKey}) must be at most ${maxLength} characters.`;
              }
            }
          }
          break;
        }
        if (typeof val !== "string") {
          errors[field.key] = `Field '${field.name}' must be a string or document.`;
        } else {
          if (minLength !== undefined && val.length < minLength) {
            errors[field.key] = `Field '${field.name}' must be at least ${minLength} characters.`;
          }
          if (maxLength !== undefined && val.length > maxLength) {
            errors[field.key] = `Field '${field.name}' must be at most ${maxLength} characters.`;
          }
          if (pattern && !new RegExp(pattern).test(val)) {
            errors[field.key] = `Field '${field.name}' does not match the required format pattern.`;
          }
        }
        break;

      case "url":
        if (typeof val !== "string") {
          errors[field.key] = `Field '${field.name}' must be a valid URL string.`;
        } else {
          try {
            new URL(val);
          } catch {
            errors[field.key] = `Field '${field.name}' must be a valid absolute URL (e.g. https://example.com).`;
          }
        }
        break;

      case "email":
        if (typeof val !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          errors[field.key] = `Field '${field.name}' must be a valid email address.`;
        }
        break;

      case "select":
        if (field.options && field.options.length > 0) {
          const allowed = field.options.map((o) => o.value);
          if (!allowed.includes(val as string | number)) {
            errors[field.key] = `Field '${field.name}' must be one of: ${allowed.join(", ")}`;
          }
        }
        break;

      case "multi_select":
      case "taxonomy":
        if (!Array.isArray(val)) {
          errors[field.key] = `Field '${field.name}' must be an array.`;
        } else if (field.type === "multi_select" && field.options && field.options.length > 0) {
          const allowed = field.options.map((o) => o.value);
          const invalid = val.filter((item) => !allowed.includes(item as string | number));
          if (invalid.length > 0) {
            errors[field.key] = `Field '${field.name}' contains invalid options: ${invalid.join(", ")}`;
          }
        }
        break;

      case "relation_list":
        if (!Array.isArray(val)) {
          errors[field.key] = `Field '${field.name}' must be an array of entry IDs.`;
        } else {
          if (field.required && val.length === 0) {
            errors[field.key] = `Field '${field.name}' is required and must contain at least one relation.`;
          }
          const maxItems = field.max ?? MAX_RELATION_LIST_ITEMS;
          if (val.length > maxItems) {
            errors[field.key] = `Field '${field.name}' cannot exceed ${maxItems} items.`;
          }
          for (let i = 0; i < val.length; i++) {
            const item = val[i];
            if (typeof item === "string") {
              if (!item.trim()) {
                errors[field.key] = `Field '${field.name}' relation ID at index ${i} cannot be empty.`;
                break;
              }
            } else if (typeof item === "object" && item !== null && !Array.isArray(item)) {
              const relObj = item as Record<string, unknown>;
              if (!relObj.id && !relObj.slug) {
                errors[field.key] = `Field '${field.name}' relation item at index ${i} must contain an 'id' or 'slug'.`;
                break;
              }
            } else {
              errors[field.key] = `Field '${field.name}' items must be relation ID strings or entry objects.`;
              break;
            }
          }
        }
        break;

      case "date":
      case "datetime":
        if (typeof val === "string" || typeof val === "number" || val instanceof Date) {
          const d = new Date(val);
          if (isNaN(d.getTime())) {
            errors[field.key] = `Field '${field.name}' must be a valid date/datetime.`;
          }
        } else {
          errors[field.key] = `Field '${field.name}' must be a date string or timestamp.`;
        }
        break;

      case "media":
        if (typeof val === "string") {
          // Can be asset ID (e.g. med_...) or URL
          if (!val.trim()) {
            errors[field.key] = `Field '${field.name}' media reference cannot be empty.`;
          }
        } else if (typeof val === "object" && val !== null) {
          const mediaObj = val as Record<string, unknown>;
          if (!mediaObj.id && !mediaObj.url) {
            errors[field.key] = `Field '${field.name}' media object must contain an 'id' or 'url'.`;
          }
        } else {
          errors[field.key] = `Field '${field.name}' must be a media ID, URL string, or media object.`;
        }
        break;

      case "relation":
        if (typeof val === "string") {
          if (!val.trim()) {
            errors[field.key] = `Field '${field.name}' relation ID cannot be empty.`;
          }
        } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          const relObj = val as Record<string, unknown>;
          if (!relObj.id && !relObj.slug) {
            errors[field.key] = `Field '${field.name}' relation must contain an 'id' or 'slug'.`;
          }
        } else {
          errors[field.key] = `Field '${field.name}' must be a referenced entry ID string or entry object.`;
        }
        break;

      case "json":
        if (typeof val !== "object" || val === null) {
          errors[field.key] = `Field '${field.name}' must be a valid JSON object or array.`;
        }
        break;

      default:
        break;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
}

export function filterEntryDataForVisibility(
  data: Record<string, unknown>,
  fieldDefs: ContentFieldDefinition[],
  userRole: "public" | "authenticated" | "staff_admin" = "public",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fieldDefs) {
    const visibility = field.apiVisibility || "public";
    if (visibility === "private" && userRole !== "staff_admin") {
      continue;
    }
    if (visibility === "authenticated" && userRole === "public") {
      continue;
    }
    if (field.key in data) {
      const val = data[field.key];

      if (field.type === "relation") {
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          const relObj = val as Record<string, unknown>;
          // Status filtering: non-staff roles cannot see draft/archived/deleted relation targets (fail-closed)
          if (userRole !== "staff_admin" && relObj.status !== "published") {
            result[field.key] = null;
            continue;
          }
          // Recursive visibility filtering on relation data (fail-closed: empty subFields returns empty object for non-staff)
          const subFields = (relObj._fields as ContentFieldDefinition[] | undefined) || [];
          const subData = (relObj.data as Record<string, unknown> | undefined) || {};
          const filteredSubData =
            Array.isArray(subFields) && subFields.length > 0
              ? filterEntryDataForVisibility(subData, subFields, userRole)
              : userRole === "staff_admin"
                ? subData
                : {};

          const cleanRel: Record<string, unknown> = {
            id: relObj.id,
            title: relObj.title,
            slug: relObj.slug,
            status: relObj.status,
            data: filteredSubData,
          };
          if (relObj.cyclic) {
            cleanRel.cyclic = true;
          }
          result[field.key] = cleanRel;
          continue;
        } else if (val === null) {
          result[field.key] = null;
          continue;
        }
      } else if (field.type === "relation_list") {
        if (Array.isArray(val)) {
          const filteredList: Array<Record<string, unknown>> = [];
          for (const item of val) {
            if (typeof item === "object" && item !== null && !Array.isArray(item)) {
              const itemObj = item as Record<string, unknown>;
              // Status filtering: non-staff roles cannot see draft/archived/deleted relation targets (fail-closed)
              if (userRole !== "staff_admin" && itemObj.status !== "published") {
                continue;
              }
              // Recursive visibility filtering on relation item data (fail-closed: empty subFields returns empty object for non-staff)
              const subFields = (itemObj._fields as ContentFieldDefinition[] | undefined) || [];
              const subData = (itemObj.data as Record<string, unknown> | undefined) || {};
              const filteredSubData =
                Array.isArray(subFields) && subFields.length > 0
                  ? filterEntryDataForVisibility(subData, subFields, userRole)
                  : userRole === "staff_admin"
                    ? subData
                    : {};

              const cleanItem: Record<string, unknown> = {
                id: itemObj.id,
                title: itemObj.title,
                slug: itemObj.slug,
                status: itemObj.status,
                data: filteredSubData,
              };
              if (itemObj.cyclic) {
                cleanItem.cyclic = true;
              }
              filteredList.push(cleanItem);
            }
          }
          result[field.key] = filteredList;
          continue;
        } else {
          result[field.key] = [];
          continue;
        }
      }

      result[field.key] = val;
    }
  }
  return result;
}

/**
 * Resolves localized values for entry data given a target locale and fallback locale.
 * If a field is defined as localizable: true, its data value can be a dictionary mapping locale -> value
 * or a single fallback value. Also handles resolving localized fields in nested relation data.
 */
export function resolveLocalizedEntryData(
  data: Record<string, unknown>,
  fieldDefs: ContentFieldDefinition[],
  targetLocale = "en",
  fallbackLocale = "en",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const normTarget = targetLocale.toLowerCase();
  const targetLang = normTarget.split("-")[0];
  const normFallback = fallbackLocale.toLowerCase();

  for (const field of fieldDefs) {
    const val = data[field.key];
    if (val === undefined || val === null) {
      result[field.key] = val;
      continue;
    }

    if (field.localizable && typeof val === "object" && !Array.isArray(val)) {
      const dict = val as Record<string, unknown>;
      const normalized = Object.fromEntries(
        Object.entries(dict).map(([key, value]) => [key.toLowerCase(), value]),
      );
      // Look for exact locale match, e.g. "ar-SA"
      if (normTarget in normalized) {
        result[field.key] = normalized[normTarget];
      } else if (targetLang && targetLang in normalized) {
        result[field.key] = normalized[targetLang];
      } else if (normFallback in normalized) {
        result[field.key] = normalized[normFallback];
      } else if ("en" in normalized) {
        result[field.key] = normalized["en"];
      } else {
        const firstVal = Object.values(dict)[0];
        result[field.key] = firstVal !== undefined ? firstVal : val;
      }
    } else if (field.type === "relation" && typeof val === "object" && val !== null && !Array.isArray(val)) {
      const relObj = val as Record<string, unknown>;
      if (relObj.data && typeof relObj.data === "object" && !Array.isArray(relObj.data)) {
        // Recursively localize target data fields if any are localized dicts
        const localizedTargetData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(relObj.data as Record<string, unknown>)) {
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            const d = v as Record<string, unknown>;
            const normalizedD = Object.fromEntries(
              Object.entries(d).map(([key, value]) => [key.toLowerCase(), value]),
            );
            if (normTarget in normalizedD) {
              localizedTargetData[k] = normalizedD[normTarget];
            } else if (targetLang && targetLang in normalizedD) {
              localizedTargetData[k] = normalizedD[targetLang];
            } else if (normFallback in normalizedD) {
              localizedTargetData[k] = normalizedD[normFallback];
            } else if ("en" in normalizedD) {
              localizedTargetData[k] = normalizedD["en"];
            } else {
              localizedTargetData[k] = Object.values(d)[0] ?? v;
            }
          } else {
            localizedTargetData[k] = v;
          }
        }
        result[field.key] = { ...relObj, data: localizedTargetData };
      } else {
        result[field.key] = val;
      }
    } else if (field.type === "relation_list" && Array.isArray(val)) {
      result[field.key] = val.map((item) => {
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const itemObj = item as Record<string, unknown>;
          if (itemObj.data && typeof itemObj.data === "object" && !Array.isArray(itemObj.data)) {
            const localizedTargetData: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(itemObj.data as Record<string, unknown>)) {
              if (typeof v === "object" && v !== null && !Array.isArray(v)) {
                const d = v as Record<string, unknown>;
                const normalizedD = Object.fromEntries(
                  Object.entries(d).map(([key, value]) => [key.toLowerCase(), value]),
                );
                if (normTarget in normalizedD) {
                  localizedTargetData[k] = normalizedD[normTarget];
                } else if (targetLang && targetLang in normalizedD) {
                  localizedTargetData[k] = normalizedD[targetLang];
                } else if (normFallback in normalizedD) {
                  localizedTargetData[k] = normalizedD[normFallback];
                } else if ("en" in normalizedD) {
                  localizedTargetData[k] = normalizedD["en"];
                } else {
                  localizedTargetData[k] = Object.values(d)[0] ?? v;
                }
              } else {
                localizedTargetData[k] = v;
              }
            }
            return { ...itemObj, data: localizedTargetData };
          }
        }
        return item;
      });
    } else {
      result[field.key] = val;
    }
  }

  return result;
}

export function extractSearchableText(
  data: Record<string, unknown>,
  fieldDefs: ContentFieldDefinition[],
): string {
  const chunks: string[] = [];
  for (const field of fieldDefs) {
    if (field.searchable !== false) {
      const val = data[field.key];
      if (typeof val === "string") {
        chunks.push(val);
      } else if (typeof val === "number" || typeof val === "boolean") {
        chunks.push(String(val));
      } else if (Array.isArray(val)) {
        chunks.push(val.filter((x) => typeof x === "string").join(" "));
      } else if (val && typeof val === "object") {
        // Localized dictionary values
        for (const localizedVal of Object.values(val)) {
          if (typeof localizedVal === "string") {
            chunks.push(localizedVal);
          }
        }
      }
    }
  }
  return chunks.join(" ").trim();
}

export function extractFilterableAttributes(
  data: Record<string, unknown>,
  fieldDefs: ContentFieldDefinition[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fieldDefs) {
    if (field.filterable && field.key in data) {
      result[field.key] = data[field.key];
    }
  }
  return result;
}

export function checkEntryDataValidity(
  data: Record<string, unknown>,
  fieldDefs: FieldWithLegacyValidation[],
): ValidationResult {
  try {
    validateEntryData(data, fieldDefs);
    return { valid: true, errors: [] };
  } catch (err) {
    if (err instanceof ValidationError) {
      const errors = Object.entries(err.fieldErrors).map(([field, message]) => ({
        field,
        message,
      }));
      return { valid: false, errors };
    }
    throw err;
  }
}

/**
 * Analyzes schema changes between old model fields and new model fields.
 * Identifies breaking changes (e.g., removing fields, changing types, adding required fields without defaults).
 */
export function analyzeSchemaEvolution(
  oldFields: FieldWithLegacyValidation[],
  newFields: FieldWithLegacyValidation[],
): {
  changes: Array<{
    key: string;
    action: "added" | "removed" | "modified";
    isSafe: boolean;
    warning?: string;
  }>;
  safe: boolean;
  warnings: string[];
} {
  const oldMap = new Map(oldFields.map((f) => [f.key, f]));
  const newMap = new Map(newFields.map((f) => [f.key, f]));
  const changes: Array<{
    key: string;
    action: "added" | "removed" | "modified";
    isSafe: boolean;
    warning?: string;
  }> = [];
  const warnings: string[] = [];
  let isOverallSafe = true;

  // Check added or modified
  for (const [key, newField] of newMap.entries()) {
    const oldField = oldMap.get(key);
    if (!oldField) {
      // Added
      if (newField.required) {
        isOverallSafe = false;
        const w = `New required field '${newField.name}' (${key}) requires migration of existing entries, even if a default is provided.`;
        warnings.push(w);
        changes.push({ key, action: "added", isSafe: false, warning: w });
      } else {
        changes.push({ key, action: "added", isSafe: true });
      }
    } else {
      // Check for type change
      if (oldField.type !== newField.type) {
        isOverallSafe = false;
        const w = `Field '${newField.name}' changed type from '${oldField.type}' to '${newField.type}'. Existing entry data may be incompatible.`;
        warnings.push(w);
        changes.push({ key, action: "modified", isSafe: false, warning: w });
      } else if (!oldField.required && newField.required) {
        isOverallSafe = false;
        const w = `Field '${newField.name}' became required. Existing entries without a value will require updates.`;
        warnings.push(w);
        changes.push({ key, action: "modified", isSafe: false, warning: w });
      } else {
        const oldVisibility = oldField.apiVisibility ?? "public";
        const newVisibility = newField.apiVisibility ?? "public";
        const visibilityRank = { public: 0, authenticated: 1, private: 2 };
        const exposureIncreased = visibilityRank[newVisibility] < visibilityRank[oldVisibility];
        const optionsNarrowed = (
          (newField.type === "select" || newField.type === "multi_select") &&
          (oldField.options ?? []).some((option) =>
            !(newField.options ?? []).some((next) => next.value === option.value))
        );
        // Match validateEntryData's top-level-first precedence for historical
        // definitions that store limits under field.validation in JSONB.
        const oldMin = oldField.min ?? oldField.validation?.min;
        const newMin = newField.min ?? newField.validation?.min;
        const oldMax = oldField.max ?? oldField.validation?.max;
        const newMax = newField.max ?? newField.validation?.max;
        const oldMinLength = oldField.minLength ?? oldField.validation?.minLength;
        const newMinLength = newField.minLength ?? newField.validation?.minLength;
        const oldMaxLength = oldField.maxLength ?? oldField.validation?.maxLength;
        const newMaxLength = newField.maxLength ?? newField.validation?.maxLength;
        const oldPattern = oldField.pattern ?? oldField.validation?.pattern;
        const newPattern = newField.pattern ?? newField.validation?.pattern;
        const constraintsTightened =
          (newMin !== undefined && newMin > (oldMin ?? -Infinity)) ||
          (newMax !== undefined && newMax < (oldMax ?? Infinity)) ||
          (newMinLength !== undefined && newMinLength > (oldMinLength ?? 0)) ||
          (newMaxLength !== undefined && newMaxLength < (oldMaxLength ?? Infinity)) ||
          (newPattern !== undefined && newPattern !== oldPattern);
        const relationChanged =
          (newField.type === "relation" || newField.type === "relation_list") &&
          oldField.relationModel !== newField.relationModel;
        const localizedChanged = Boolean(newField.localizable) !== Boolean(oldField.localizable);

        if (exposureIncreased || optionsNarrowed || constraintsTightened || relationChanged || localizedChanged) {
          isOverallSafe = false;
          const w = `Field '${newField.name}' (${key}) changed visibility, constraints, options, relation target, or localization. Existing data requires review and migration.`;
          warnings.push(w);
          changes.push({ key, action: "modified", isSafe: false, warning: w });
        } else {
          changes.push({ key, action: "modified", isSafe: true });
        }
      }
    }
  }

  // Check removed
  for (const [key, oldField] of oldMap.entries()) {
    if (!newMap.has(key)) {
      const w = `Field '${oldField.name}' (${key}) was removed. Existing entry data for this field will be preserved in DB but excluded from active schema.`;
      warnings.push(w);
      changes.push({ key, action: "removed", isSafe: true, warning: w });
    }
  }

  return { changes, safe: isOverallSafe, warnings };
}

