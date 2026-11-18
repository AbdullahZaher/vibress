#!/usr/bin/env bash
set -euo pipefail
[[ "$(node -v)" == v24.22.3 && "$(pnpm -v)" == 11.22.0 ]]
repo="$(pwd -P)"
root="$(mktemp -d "$RUNNER_TEMP/m04-external.XXXXXXXX")"
trap 'rm -rf -- "$root"' EXIT
[[ "$root/" != "$repo/"* ]]
art="$root/artifacts"
app="$root/consumer"
mkdir "$art" "$app"
pnpm --dir packages/platform-kernel pack --pack-destination "$art"
pnpm --dir packages/schema-engine pack --pack-destination "$art"
# Package the exact frozen installed compiler/type dependencies locally as well.
ts=$(node -p 'require("node:path").dirname(require.resolve("typescript/package.json"))')
nt=$(cd packages/schema-engine && node -p 'require("node:path").dirname(require.resolve("@types/node/package.json"))')
ut=$(node -p 'require("node:path").dirname(require.resolve("undici-types/package.json",{paths:[process.argv[1]]}))' "$nt")
for p in "$ts" "$nt" "$ut"; do npm pack --offline --ignore-scripts --pack-destination "$art" "$p" >/dev/null; done
for f in "$art"/*.tgz; do sha256sum "$f"; done
cp packages/m04-consumer-tests/src/fixtures/{m04-crm-consumer.ts,m04-openapi-document.ts,validate-openapi.py,openapi-3.1-2025-11-23.json,openapi-validator-requirements.txt} "$app/"
cp tests/fixtures/m04-external-consumer.ts "$app/consumer.ts"
cd "$app"
printf '%s\n' '{"name":"m04-external-local","version":"1.0.0","private":true}' > package.json
# All dependencies explicit local tarballs; no workspace or registry fallback.
npm install --offline --ignore-scripts --no-audit --no-fund "$art"/*.tgz
unset NODE_PATH TS_NODE_PROJECT TSX_TSCONFIG_PATH
node <<'JS'
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
for(const n of ["@vibress/platform-kernel","@vibress/schema-engine","typescript","@types/node","undici-types"]){
 const p=path.resolve("node_modules",n);
 assert.equal(fs.lstatSync(p).isSymbolicLink(),false);
 assert.equal(fs.realpathSync(p),p);
}
const p=require("./node_modules/@vibress/schema-engine/package.json");
assert.equal(p.dependencies["@vibress/platform-kernel"],"1.2.0");
assert.equal(require("./node_modules/@vibress/platform-kernel/package.json").version,"1.2.0");
console.log("EXTERNAL_LOCAL_TARBALL_DEPENDENCIES=PASS");
JS
cat > emit.ts <<'TS'
import { writeFileSync } from "node:fs";
import { crmConsumer } from "./m04-crm-consumer";
writeFileSync("generated.ts", crmConsumer().contracts.typescript);
TS
# The packages deliberately expose TS source. Use a documented source-bundling
# consumer rather than pretend Node can load TS under node_modules directly.
bundle() {
 "$repo/node_modules/.bin/esbuild" "$1" --bundle --platform=node --format=cjs --outfile="$2" --metafile="$2.meta.json"
 node - "$2.meta.json" <<'JS'
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const inputs=Object.keys(JSON.parse(fs.readFileSync(process.argv[2],"utf8")).inputs);
for(const i of inputs) assert.ok(fs.realpathSync(i).startsWith(process.cwd()+path.sep),i);
for(const n of ["platform-kernel","schema-engine"]) assert.ok(inputs.some(i=>i.startsWith("node_modules/@vibress/"+n+"/")),n);
JS
}
bundle emit.ts emit.cjs
node emit.cjs
cat > tsconfig.json <<'JSON'
{"compilerOptions":{"target":"ES2022","module":"CommonJS","moduleResolution":"node","strict":true,"exactOptionalPropertyTypes":true,"noUncheckedIndexedAccess":true,"skipLibCheck":true,"esModuleInterop":true,"types":["node"],"noEmit":true},"include":["*.ts"]}
JSON
node node_modules/typescript/bin/tsc -p tsconfig.json
echo EXTERNAL_STRICT_TYPES=PASS
bundle consumer.ts consumer.cjs
node consumer.cjs
bundle m04-openapi-document.ts openapi.cjs
node openapi.cjs > documents.json
python3 -m venv "$root/venv"
"$root/venv/bin/python" -m pip install --disable-pip-version-check --no-deps --only-binary=:all: -r openapi-validator-requirements.txt
"$root/venv/bin/python" -m pip check
"$root/venv/bin/python" validate-openapi.py documents.json
echo EXTERNAL_M04_CLEAN_CONSUMER=PASS
