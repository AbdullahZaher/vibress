// Independent in-repository consumer: public exports only; no runtime or DB.
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import { compileCrudContracts, compileResourceSchema, createSchemaManifest, createMockContractClient,
  type MockContractRequest, type MockContractTransport, type CrudAdminMetadata } from "@vibress/schema-engine";

export function crmConsumer() {
  const scope = { applicationId: asApplicationId("crm-consumer"), installationId: asInstallationId("crm-demo") };
  const manifest = createSchemaManifest(compileResourceSchema([{ ...scope, id: "deals", ownership: "tenant", fields: [
    { id: "title", type: "text", required: true },
    { id: "amount", type: "number", required: false },
    { id: "reason", type: "text", required: false },
    { id: "approved", type: "boolean", required: false },
    { id: "stage", type: "enum", required: false, values: ["lead", "won"] },
    { id: "secret_note", type: "text", required: false },
    { id: "occurred_at", type: "datetime", required: false },
  ] }], scope));
  const contracts = compileCrudContracts(manifest, { ...scope, expectedManifestDigest: manifest.digest,
    exposure: [{ resourceId: "deals", fields: ["title", "amount", "reason", "approved", "stage", "occurred_at"], readOnly: ["approved"] }],
    customOperations: [{ resourceId: "deals", actionId: "approve", fields: ["reason"] }] });
  const row = { id: "deal_1", version: "rev_1", data: { title: "صفقة <demo>", amount: 20, reason: null, approved: false, stage: "lead", occurred_at: null } };
  const requests: MockContractRequest[] = [];
  function mock(fixture: { installation: string; tenant: string; permissions: readonly string[]; authenticated: boolean }) {
    const transport: MockContractTransport = { async send(request) {
      requests.push(request);
      // Deliberately separate TEST fixture from request input. This is NOT
      // server-side authentication or an actual tenant policy implementation.
      const operation = contracts.operations.find(op => op.operationId === request.operationId);
      if (!fixture.authenticated) return { status: 401, body: { code: "UNAUTHENTICATED" } };
      if (!operation || fixture.installation !== scope.installationId || fixture.tenant !== "tenant_a" ||
        !fixture.permissions.includes(operation.authorization.permission)) return { status: 403, body: { code: "FORBIDDEN" } };
      if (operation.action === "list") return { status: 200, body: { items: [row], nextCursor: null } };
      if (operation.action === "create") return { status: 201, body: row };
      if (operation.action === "delete") return { status: 200, body: { id: row.id } };
      return { status: 200, body: row };
    } };
    return createMockContractClient(contracts, { mode: "MOCK_ONLY", transport });
  }
  const permitted = { installation: scope.installationId, tenant: "tenant_a", authenticated: true,
    permissions: contracts.operations.map(op => op.authorization.permission) };
  return { contracts, scope, row, requests, mock, permitted };
}
const esc = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
type ViewState = "loading" | "error" | "runtime-disabled" | "mock-ready";
/** Isolated reference HTML renderer. Never installs event handlers or submits. */
export function renderMockAdmin(meta: CrudAdminMetadata, data: Readonly<Record<string, unknown>>, state: ViewState): string {
  if (state !== "mock-ready") return '<section role="status" data-state="' + state + '"></section>';
  const form = meta.forms.find(f => f.operationId.endsWith(".create"));
  const fields = meta.fields.filter(f => form?.fields.includes(f.id) && f.editable);
  const controls = fields.map(f => {
    const id = esc(f.id);
    const control = f.widget === "select"
      ? '<select id="' + id + '" disabled>' + (f.values ?? []).map(v => '<option>' + esc(v) + '</option>').join("") + '</select>'
      : '<input id="' + id + '" type="' + (f.widget === "datetime" ? "text" : f.widget) + '" disabled' + (f.required ? ' required' : '') + '>';
    return '<label for="' + id + '">' + id + '</label>' + control;
  }).join("");
  const head = meta.columns.map(id => '<th scope="col">' + esc(id) + '</th>').join("");
  const cells = meta.columns.map(id => {
    const value = data[id];
    return '<td>' + esc(value === null || value === undefined ? "" : String(value)) + '</td>';
  }).join("");
  return '<section data-state="mock-ready"><form aria-label="Mock form">' + controls +
    '<button type="button" disabled>Mock only</button></form><table><thead><tr>' + head +
    '</tr></thead><tbody><tr>' + cells + '</tr></tbody></table></section>';
}
