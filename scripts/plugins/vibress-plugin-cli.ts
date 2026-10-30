#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  cliInit,
  cliValidate,
  cliPackage,
  cliSign,
  cliVerify,
  cliGenerateKeypair,
} from "../../packages/plugin-sdk/src/cli";

function printUsage(): void {
  console.log(`
Vibress Plugin Developer CLI
Usage:
  tsx scripts/plugins/vibress-plugin-cli.ts init <plugin-id> <plugin-name> [outputDir]
  tsx scripts/plugins/vibress-plugin-cli.ts validate <manifestPath>
  tsx scripts/plugins/vibress-plugin-cli.ts package <pluginDir>
  tsx scripts/plugins/vibress-plugin-cli.ts keygen [outKeyPrefix]
  tsx scripts/plugins/vibress-plugin-cli.ts sign <filePath> <privateKeyPemPath>
  tsx scripts/plugins/vibress-plugin-cli.ts verify <filePath> <signatureBase64> <publicKeyPemPath>
`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case "init": {
      const [id, name, targetDir] = args;
      if (!id || !name) {
        console.error("Error: plugin-id and plugin-name are required.");
        process.exit(1);
      }
      const dir = targetDir ? path.resolve(targetDir) : path.resolve(process.cwd(), id);
      cliInit(dir, { id, name });
      console.log(`Plugin project scaffolded successfully at ${dir}`);
      break;
    }

    case "validate": {
      const [manifestPath] = args;
      if (!manifestPath) {
        console.error("Error: manifestPath is required.");
        process.exit(1);
      }
      const result = cliValidate(path.resolve(manifestPath));
      if (!result.valid) {
        console.error("Validation FAILED:");
        result.errors.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      } else {
        console.log("Validation PASSED.");
        result.warnings.forEach((w) => console.warn(`  [Warning] ${w}`));
      }
      break;
    }

    case "package": {
      const [pluginDir] = args;
      if (!pluginDir) {
        console.error("Error: pluginDir is required.");
        process.exit(1);
      }
      const pkg = cliPackage(path.resolve(pluginDir));
      console.log(`Plugin packaged: ${pkg.pluginId}@${pkg.version}`);
      console.log(`Release digest: ${pkg.releaseDigest}`);
      break;
    }

    case "keygen": {
      const prefix = args[0] || "operator-plugin-key";
      const { publicKeyPem, privateKeyPem } = cliGenerateKeypair();
      writeFileSync(`${prefix}.pub.pem`, publicKeyPem, "utf8");
      writeFileSync(`${prefix}.key.pem`, privateKeyPem, "utf8");
      console.log(`Generated keypair: ${prefix}.pub.pem, ${prefix}.key.pem`);
      break;
    }

    case "sign": {
      const [filePath, keyPath] = args;
      if (!filePath || !keyPath) {
        console.error("Error: filePath and privateKeyPemPath are required.");
        process.exit(1);
      }
      const fileBytes = readFileSync(path.resolve(filePath));
      const keyPem = readFileSync(path.resolve(keyPath), "utf8");
      const sig = cliSign(fileBytes, keyPem);
      console.log(sig);
      break;
    }

    case "verify": {
      const [filePath, signature, pubKeyPath] = args;
      if (!filePath || !signature || !pubKeyPath) {
        console.error("Error: filePath, signatureBase64, and publicKeyPemPath are required.");
        process.exit(1);
      }
      const fileBytes = readFileSync(path.resolve(filePath));
      const pubKeyPem = readFileSync(path.resolve(pubKeyPath), "utf8");
      const valid = cliVerify(fileBytes, signature, pubKeyPem);
      if (valid) {
        console.log("Signature is VALID.");
      } else {
        console.error("Signature verification FAILED.");
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

if (process.argv[1]?.endsWith("vibress-plugin-cli.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
