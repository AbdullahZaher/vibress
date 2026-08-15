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
      case "relation":
      case "json":
      default:
        // Permissive structure validation for media URLs/IDs, relations, or arbitrary JSON objects
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
