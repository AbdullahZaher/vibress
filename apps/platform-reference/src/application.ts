import { randomUUID } from "node:crypto";
import {
  defineAction,
  defineApplication,
  type ApplicationDefinition,
} from "@vibress/platform-kernel";

export const REFERENCE_APPLICATION_ID = "reference-crm";

export const REFERENCE_PERMISSIONS = Object.freeze({
  readCustomers: "crm.customers.read",
  createCustomer: "crm.customers.create",
});

export interface ReferenceCustomer {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
}

export interface CreateCustomerInput {
  readonly name: string;
  readonly email: string | null;
}

const noInput = (): null => null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCreateCustomerInput(value: unknown): CreateCustomerInput {
  if (typeof value !== "object" || value === null) {
    throw new Error("request body must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0 || name.length > 200) {
    throw new Error("name must be between 1 and 200 characters");
  }
  const rawEmail = record.email;
  if (
    rawEmail !== undefined &&
    rawEmail !== null &&
    typeof rawEmail !== "string"
  ) {
    throw new Error("email must be a string");
  }
  const email = typeof rawEmail === "string" ? rawEmail.trim() : null;
  if (email !== null && (email.length > 320 || !EMAIL_PATTERN.test(email))) {
    throw new Error("email is not a valid address");
  }
  return { name, email };
}

export function createReferenceApplication(
  options: { readonly id?: string } = {},
): ApplicationDefinition {
  const id = options.id ?? REFERENCE_APPLICATION_ID;
  return defineApplication({
    id,
    name: "Reference CRM",
    version: "1.0.0",
    actions: {
      health: defineAction({
        name: "health",
        permission: "platform.health",
        input: noInput,
        handler: async () => ({
          status: "ok",
          application: id,
        }),
      }),
      listCustomers: defineAction({
        name: "listCustomers",
        permission: REFERENCE_PERMISSIONS.readCustomers,
        input: noInput,
        handler: async ({ transaction }) => {
          const result = await transaction.query<ReferenceCustomer>(
            `SELECT id, name, email
               FROM platform_crm_customers
              ORDER BY created_at, id`,
          );
          return { customers: result.rows };
        },
      }),
      createCustomer: defineAction({
        name: "createCustomer",
        permission: REFERENCE_PERMISSIONS.createCustomer,
        input: parseCreateCustomerInput,
        handler: async ({ context, input, transaction }) => {
          if (!context.tenantId) {
            throw new Error("createCustomer requires a verified tenant scope");
          }
          const result = await transaction.query<ReferenceCustomer>(
            `INSERT INTO platform_crm_customers
               (id, application_id, tenant_id, name, email)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, email`,
            [
              randomUUID(),
              context.applicationId,
              context.tenantId,
              input.name,
              input.email,
            ],
          );
          return result.rows[0];
        },
      }),
    },
    http: [
      { method: "GET", path: "/health", action: "health", auth: "public" },
      {
        method: "GET",
        path: "/crm/customers",
        action: "listCustomers",
        auth: "member",
      },
      {
        method: "POST",
        path: "/crm/customers",
        action: "createCustomer",
        auth: "staff",
      },
    ],
  });
}
