/**
 * SDK-NUI-02 (experimental): pure TypeScript authoring helpers for the
 * EXISTING Native Admin V1 wire contracts. These functions return their
 * argument without transformation. They neither validate untrusted runtime
 * input nor approve permissions, database models, routes, releases or actions.
 *
 * The Host always validates each declaration against its strict runtime
 * schemas and checks authorization for every operation. No Admin JS/React
 * code, network, filesystem or private Host package is imported here.
 */
import type { PluginNativeAdminPageV1 } from "./native-admin-ui";
import type { PluginAdminDataResourceV1, PluginAdminDataActionV1 } from "./native-admin-data";
import type { PluginAdminDomainWorkflowV1 } from "./native-domain-workflow";

export function defineNativeAdminPageV1<const T extends PluginNativeAdminPageV1>(page: T): T {
  return page;
}

export function defineNativeAdminResourceV1<const T extends PluginAdminDataResourceV1>(resource: T): T {
  return resource;
}

export function defineNativeAdminActionV1<const T extends PluginAdminDataActionV1>(action: T): T {
  return action;
}

export function defineNativeDomainWorkflowV1<const T extends PluginAdminDomainWorkflowV1>(workflow: T): T {
  return workflow;
}
