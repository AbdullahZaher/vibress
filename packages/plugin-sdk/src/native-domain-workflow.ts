/** NUI-05: inert schema for an existing operator-approved domain POST route.
 * This describes the form only. The Host and plugin handler retain all
 * authorization, publication, concurrency and business lifecycle checks.
 */
export interface PluginAdminDomainWorkflowV1 {
  readonly schemaVersion: 1;
  readonly viewId: string;
  /** Must equal the Host-admitted GET view's routeId and a paired Admin POST. */
  readonly routeId: string;
  readonly idField: string;
  readonly versionField: string;
  readonly operationField: string;
  readonly fields: readonly {
    readonly key: string;
    readonly label: { readonly en: string; readonly ar: string };
    readonly multiline?: boolean | undefined;
    readonly maxLength: number;
  }[];
  /** Host renders exactly these supported workflow buttons. */
  readonly operations: readonly ("create" | "save" | "publish")[];
}
