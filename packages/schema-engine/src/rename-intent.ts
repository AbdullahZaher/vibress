import { createHash } from "node:crypto";
import { parseSchemaManifest } from "./planning";
import {
  compileProvisioningContract,
  provisioningIdentifier as qi,
  type ProvisionedResource,
} from "./physical-contract";
import type { SchemaCompilationScope } from "./schema";

export interface RenameIntentV1 {
  readonly version: 1;
  readonly resourceId: string;
  readonly from: string;
  readonly to: string;
  readonly rationale: string;
}

/** Explicit, non-inferred rename preparation. No phase is executable here:
 * EXPAND is rendered for the installer, BACKFILL requires a signed bounded
 * backfill operation, VALIDATE is an operator predicate, and CONTRACT (the
 * destructive drop of the source column) is never part of this artifact. */
export interface RenameIntentPlanV1 {
  readonly version: 1;
  readonly profile: "M03_RENAME_INTENT_V1";
  readonly authorization: "NONE";
  readonly compatibility: "EXPAND_AND_BACKFILL";
  readonly destructive: false;
  readonly resource: { readonly id: string; readonly table: string };
  readonly from: { readonly column: string; readonly type: string };
  readonly to: { readonly column: string; readonly type: string };
  readonly phases: {
    readonly expand: { readonly execution: "INSTALLER_REVIEW_REQUIRED"; readonly statements: readonly string[] };
    readonly backfill: {
      readonly sourceColumn: string;
      readonly targetColumn: string;
      readonly execution: "SIGNED_BOUNDED_BACKFILL_REQUIRED";
    };
    readonly validate: { readonly predicates: readonly string[] };
    readonly contract: { readonly executable: false; readonly note: string };
  };
  readonly digest: string;
}

const refuse = (): never => {
  throw Error("RENAME_INTENT_REFUSED");
};
const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identifier = /^[a-z][a-z0-9_]{0,62}$/;
const checked = (resource: ProvisionedResource, column: string): boolean =>
  (resource.checks ?? []).some((check) => check.columns.includes(column));

function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function compileRenameIntent(
  current: unknown,
  proposed: unknown,
  intent: RenameIntentV1,
  scope: SchemaCompilationScope,
): RenameIntentPlanV1 {
  if (current === null || intent === null || typeof intent !== "object") return refuse();
  if (
    intent.version !== 1 ||
    !identifier.test(intent.resourceId) ||
    !identifier.test(intent.from) ||
    !identifier.test(intent.to) ||
    intent.from === intent.to ||
    typeof intent.rationale !== "string" ||
    intent.rationale.trim().length < 8
  ) return refuse();
  const before = parseSchemaManifest(current), after = parseSchemaManifest(proposed);
  if (before.applicationId !== scope.applicationId || before.installationId !== scope.installationId) return refuse();
  if (after.applicationId !== scope.applicationId || after.installationId !== scope.installationId) return refuse();
  // A rename must be the only difference between the two revisions.
  if (before.resources.length !== after.resources.length) return refuse();
  for (const old of before.resources) {
    if (old.id === intent.resourceId) continue;
    const same = after.resources.find((resource) => resource.id === old.id);
    if (!same || !structurallyEqual(same, old)) return refuse();
  }
  const physicalBefore = compileProvisioningContract(before, scope);
  const physicalAfter = compileProvisioningContract(after, scope);
  const oldResource = physicalBefore.resources.find((resource) => resource.id === intent.resourceId);
  const newResource = physicalAfter.resources.find((resource) => resource.id === intent.resourceId);
  if (!oldResource || !newResource) return refuse();
  if (
    oldResource.table !== newResource.table ||
    oldResource.ownership !== newResource.ownership ||
    !structurallyEqual(oldResource.key, newResource.key) ||
    !structurallyEqual(oldResource.unique, newResource.unique) ||
    !structurallyEqual(oldResource.relations, newResource.relations)
  ) return refuse();
  const source = oldResource.columns.find((column) => column.name === intent.from);
  if (!source || checked(oldResource, intent.from)) return refuse();
  const target = newResource.columns.find((column) => column.name === intent.to);
  if (!target || target.required || target.enumValues || target.target || checked(newResource, intent.to)) return refuse();
  if (target.type !== source.type) return refuse();
  const expectedColumns = [
    ...oldResource.columns.filter((column) => column.name !== intent.from),
    target,
  ];
  if (
    expectedColumns.length !== newResource.columns.length ||
    expectedColumns.some((column) => {
      const observed = newResource.columns.find((candidate) => candidate.name === column.name);
      return !observed || !structurallyEqual(observed, column);
    })
  ) return refuse();
  const qualified = qi(physicalBefore.namespace) + "." + qi(oldResource.table);
  const body = {
    version: 1 as const,
    profile: "M03_RENAME_INTENT_V1" as const,
    authorization: "NONE" as const,
    compatibility: "EXPAND_AND_BACKFILL" as const,
    destructive: false as const,
    resource: { id: oldResource.id, table: oldResource.table },
    from: { column: source.name, type: source.type },
    to: { column: target.name, type: target.type },
    phases: {
      expand: {
        execution: "INSTALLER_REVIEW_REQUIRED" as const,
        statements: ["ALTER TABLE " + qualified + " ADD COLUMN " + qi(target.name) + " " + target.type],
      },
      backfill: {
        sourceColumn: source.name,
        targetColumn: target.name,
        execution: "SIGNED_BOUNDED_BACKFILL_REQUIRED" as const,
      },
      validate: { predicates: ["count(*) FILTER (WHERE " + qi(target.name) + " IS NULL) = 0"] },
      contract: {
        executable: false as const,
        note: "Dropping the source column is never produced by the rename-intent compiler; it requires an approved destructive contract phase.",
      },
    },
  };
  return { ...body, digest: hash(body) };
}

/** Exported only so callers can assert that the plan never carries DDL authority. */
export const RENAME_INTENT_AUTHORIZATION = "NONE" as const;
