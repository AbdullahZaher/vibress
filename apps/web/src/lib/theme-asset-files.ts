import fs from "node:fs";
import path from "node:path";

/**
 * Theme assets may be uploaded or inherited from legacy installations.
 * The requested entry must be a regular file *inside* its trusted theme
 * root after symlink resolution; do not follow a file symlink elsewhere.
 */
export function resolveContainedThemeAsset(root: string, candidate: string): string | null {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    return null;
  }
  try {
    const realRoot = fs.realpathSync(rootPath);
    const realCandidate = fs.realpathSync(candidatePath);
    const realRelative = path.relative(realRoot, realCandidate);
    if (!realRelative || realRelative === ".." ||
        realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      return null;
    }
    return fs.statSync(realCandidate).isFile() ? realCandidate : null;
  } catch {
    return null;
  }
}
