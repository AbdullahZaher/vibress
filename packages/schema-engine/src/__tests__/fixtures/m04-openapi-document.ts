import { compileCrudContracts, compileResourceSchema, createSchemaManifest } from "@vibress/schema-engine";
import { asApplicationId, asInstallationId } from "@vibress/platform-kernel";
import { crmConsumer } from "./m04-crm-consumer";

const scope = { applicationId: asApplicationId("oas-fixture"), installationId: asInstallationId("oas-local") };
const manifest = createSchemaManifest(compileResourceSchema([{ ...scope, id: "settings", ownership: "application",
  fields: [{ id: "name", type: "text", required: true }, { id: "active", type: "boolean", required: false }] }], scope));
const second = compileCrudContracts(manifest, { ...scope, expectedManifestDigest: manifest.digest,
  exposure: [{ resourceId: "settings", fields: ["name", "active"] }] });
process.stdout.write(JSON.stringify([crmConsumer().contracts.openapi, second.openapi]));
