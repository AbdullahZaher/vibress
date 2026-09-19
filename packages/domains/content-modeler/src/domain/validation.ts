import { ContentFieldDefinition } from "./types";

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

export const RESERVED_FIELD_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export const MAX_FIELDS_PER_MODEL = 100;
export const MAX_DATA_PAYLOAD_BYTES = 1024 * 1024; // 1 MB
export const MAX_RELATION_EXPANSION_DEPTH = 3;

export function validateModelDefinition(input: {
  name: string;
  slug?: string | undefined;
  fields?: ContentFieldDefinition[] | undefined;
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
  }
}

export function validateEntryData(
  data: Record<string, unknown>,
  fieldDefs: (ContentFieldDefinition & {
    validation?: {
      min?: number;
      max?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
  })[],
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
      case "relation_list":
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
        } else if (typeof val === "object" && val !== null) {
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
      result[field.key] = data[field.key];
    }
  }
  return result;
}

/**
 * Resolves localized values for entry data given a target locale and fallback locale.
 * If a field is defined as localizable: true, its data value can be a dictionary mapping locale -> value
 * or a single fallback value.
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
      // Look for exact locale match, e.g. "ar-SA"
      if (normTarget in dict) {
        result[field.key] = dict[normTarget];
      } else if (targetLang && targetLang in dict) {
        result[field.key] = dict[targetLang];
      } else if (normFallback in dict) {
        result[field.key] = dict[normFallback];
      } else if ("en" in dict) {
        result[field.key] = dict["en"];
      } else {
        const firstVal = Object.values(dict)[0];
        result[field.key] = firstVal !== undefined ? firstVal : val;
      }
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
  fieldDefs: (ContentFieldDefinition & {
    validation?: {
      min?: number;
      max?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    };
  })[],
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
  oldFields: ContentFieldDefinition[],
  newFields: ContentFieldDefinition[],
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
      if (newField.required && newField.defaultValue === undefined) {
        isOverallSafe = false;
        const w = `New required field '${newField.name}' (${key}) has no default value and may fail on existing entries.`;
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
        changes.push({ key, action: "modified", isSafe: true });
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

