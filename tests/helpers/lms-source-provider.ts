import { execSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";

export const PINNED_LMS_COMMIT = "90b771ecc64c58251fac1d8c7fdcf3278a71ea6c";
export const LMS_REPO_URL = "https://github.com/AbdullahZaher/vibress-lms.git";

export interface LmsSourceArtifacts {
  lmsDir: string;
  releaseDir: string;
  artifactPath: string;
  planPath: string;
  lockfilePath: string;
  liveHostAcceptancePath: string;
}

function getLatestMtime(dir: string): number {
  let latest = 0;
  if (!existsSync(dir)) return latest;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      latest = Math.max(latest, getLatestMtime(fullPath));
    } else {
      const stats = statSync(fullPath);
      latest = Math.max(latest, stats.mtimeMs);
    }
  }
  return latest;
}

export function resolveLmsDirectory(): string {
  if (process.env.VIBRESS_LMS_DIR && existsSync(process.env.VIBRESS_LMS_DIR)) {
    return path.resolve(process.env.VIBRESS_LMS_DIR);
  }

  const dotLmsSource = path.resolve(process.cwd(), ".lms-source");
  if (existsSync(dotLmsSource)) {
    return dotLmsSource;
  }

  const siblingLms = path.resolve(process.cwd(), "../vibress-lms");
  if (existsSync(siblingLms)) {
    return siblingLms;
  }

  const testsSibling = path.resolve(__dirname, "../../../vibress-lms");
  if (existsSync(testsSibling)) {
    return testsSibling;
  }

  // Fallback: clone into .lms-source at pinned commit
  console.info(`[lms-source-provider] Cloning ${LMS_REPO_URL} at commit ${PINNED_LMS_COMMIT} into ${dotLmsSource}...`);
  execSync(`git clone ${LMS_REPO_URL} "${dotLmsSource}"`, { stdio: "inherit" });
  execSync(`git checkout ${PINNED_LMS_COMMIT}`, { cwd: dotLmsSource, stdio: "inherit" });
  return dotLmsSource;
}

export async function resolveAndBuildLmsArtifacts(): Promise<LmsSourceArtifacts> {
  const lmsDir = resolveLmsDirectory();
  const releaseDir = path.join(lmsDir, "dist", "pilot-release");
  const artifactPath = path.join(releaseDir, "vibress-lms-pilot.mjs");
  const planPath = path.join(releaseDir, "operator-migration-plan.json");
  const lockfilePath = path.join(releaseDir, "trusted-plugins.json");
  const liveHostAcceptancePath = path.join(lmsDir, "src", "acceptance", "live-host.mjs");

  // Ensure dependencies are installed
  const nodeModulesDir = path.join(lmsDir, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    console.info(`[lms-source-provider] Installing LMS dependencies in ${lmsDir}...`);
    const hasLockfile = existsSync(path.join(lmsDir, "package-lock.json"));
    execSync(hasLockfile ? "npm ci" : "npm install", { cwd: lmsDir, stdio: "inherit" });
  }

  // Check if build is needed or stale
  let needsBuild = false;
  if (!existsSync(artifactPath) || !existsSync(planPath) || !existsSync(lockfilePath)) {
    needsBuild = true;
  } else {
    const artifactMtime = statSync(artifactPath).mtimeMs;
    const srcDir = path.join(lmsDir, "src");
    const packageJsonPath = path.join(lmsDir, "package.json");
    const latestSrcMtime = Math.max(
      getLatestMtime(srcDir),
      existsSync(packageJsonPath) ? statSync(packageJsonPath).mtimeMs : 0,
    );
    if (latestSrcMtime > artifactMtime) {
      console.info(`[lms-source-provider] Source files newer than artifact (mtime ${latestSrcMtime} > ${artifactMtime}). Rebuilding...`);
      needsBuild = true;
    }
  }

  if (needsBuild) {
    console.info(`[lms-source-provider] Building LMS pilot release in ${lmsDir}...`);
    execSync("npm run release:pilot", { cwd: lmsDir, stdio: "inherit" });
  }

  if (!existsSync(artifactPath) || !existsSync(planPath) || !existsSync(lockfilePath)) {
    throw new Error(`Failed to build or locate LMS pilot release artifacts in ${releaseDir}`);
  }

  return {
    lmsDir,
    releaseDir,
    artifactPath,
    planPath,
    lockfilePath,
    liveHostAcceptancePath,
  };
}
