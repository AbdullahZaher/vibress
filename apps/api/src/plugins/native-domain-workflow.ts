import type { PluginModule } from "@vibress/plugin-sdk";
import {
  ExtensionNativeDomainWorkflowsV1Schema,
  type ExtensionNativeDomainWorkflowV1,
} from "@vibress/api-contracts";
import { admitNativeAdminPage } from "./native-admin-registry";

type WorkflowAdmission = { readonly kind: "absent" | "invalid" } |
  { readonly kind: "admitted"; readonly workflow: ExtensionNativeDomainWorkflowV1 };

/** A workflow can ONLY enhance a previously admitted Admin GET view and the
 * paired, permission-checked POST with the exact same route ID. */
export function admitNativeDomainWorkflow(module: PluginModule, viewId: string): WorkflowAdmission {
  if (module.adminDomainWorkflows === undefined) return { kind: "absent" };
  const parsed = ExtensionNativeDomainWorkflowsV1Schema.safeParse(module.adminDomainWorkflows);
  if (!parsed.success) return { kind: "invalid" };
  for (const workflow of parsed.data) {
    const view = admitNativeAdminPage(module, workflow.viewId);
    if (view.kind !== "admitted" || view.routeId !== workflow.routeId ||
        view.permission !== "plugins.manage") return { kind: "invalid" };
    const postRoutes = module.routes?.filter((route) =>
      route.id === workflow.routeId && route.audience === "admin" &&
      route.method === "POST" && route.permission === "plugins.manage") ?? [];
    if (postRoutes.length !== 1 || !postRoutes[0]) return { kind: "invalid" };
    const body = postRoutes[0].body;
    const response = postRoutes[0].response;
    if (!body || body.fields[workflow.idField] !== "string" ||
        body.fields[workflow.versionField] !== "number" ||
        body.fields[workflow.operationField] !== "string" ||
        !workflow.fields.every((field) => body.fields[field.key] === "string") ||
        ![workflow.idField, workflow.versionField, workflow.operationField,
          ...workflow.fields.map((field) => field.key)]
          .every((name) => body.required?.includes(name)) ||
        response.fields.outcome !== "string" ||
        response.fields[workflow.idField] !== "string" ||
        response.fields.version !== "number" || response.fields.status !== "string") {
      return { kind: "invalid" };
    }
  }
  const selected = parsed.data.find((workflow) => workflow.viewId === viewId);
  return selected ? { kind: "admitted", workflow: selected } : { kind: "absent" };
}
