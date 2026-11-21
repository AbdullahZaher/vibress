import {
  asApplicationId,
  defineAction,
  defineApplication,
} from "@vibress/platform-kernel";

/**
 * External CRM consumer fixture. It imports only the public kernel entry:
 * no monorepo-relative path, no Fastify, no database or private package import.
 */
export const externalCrm = defineApplication({
  id: asApplicationId("external-crm"),
  name: "External CRM Consumer",
  version: "1.0.0",
  actions: {
    approveDeal: defineAction({
      name: "approveDeal",
      permission: "deals.approve",
      input: (value: unknown) => {
        if (typeof value !== "object" || value === null) {
          throw new Error("request body must be an object");
        }
        const record = value as Record<string, unknown>;
        const dealId = record.dealId;
        if (typeof dealId !== "string" || dealId.trim() === "") {
          throw new Error("dealId must be a non-empty string");
        }
        return { dealId };
      },
      handler: async ({ context, input }) => ({
        dealId: input.dealId,
        tenantId: context.tenantId,
        approvedBy: context.principal?.id ?? null,
      }),
    }),
  },
  http: [
    {
      method: "POST",
      path: "/crm/deals/:dealId/approve",
      action: "approveDeal",
      auth: "member",
    },
  ],
});
