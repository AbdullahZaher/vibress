export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
  build?: string[];
}

const SEMVER_REGEX =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Parses a semantic version string into its constituent parts according to SemVer 2.0.0.
 * Returns null if the version string is invalid.
 */
export function parseSemver(version: string | null | undefined): SemVer | null {
  if (!version || typeof version !== "string") {
    return null;
  }

  const trimmed = version.trim();
  const match = SEMVER_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);
  const patch = parseInt(match[3]!, 10);
  const prerelease = match[4] ? match[4].split(".") : undefined;
  const build = match[5] ? match[5].split(".") : undefined;

  return {
    major,
    minor,
    patch,
    ...(prerelease ? { prerelease } : {}),
    ...(build ? { build } : {}),
  };
}

/**
 * Compares two SemVer identifier segments (numeric vs alphanumeric per SemVer spec).
 */
function compareIdentifiers(a: string, b: string): number {
  const isANum = /^\d+$/.test(a);
  const isBNum = /^\d+$/.test(b);

  if (isANum && isBNum) {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    return numA === numB ? 0 : numA < numB ? -1 : 1;
  }

  if (isANum && !isBNum) {
    // Numeric identifiers always have lower precedence than non-numeric identifiers
    return -1;
  }

  if (!isANum && isBNum) {
    return 1;
  }

  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Compares two semantic versions.
 * Returns:
 *  -1 if v1 < v2
 *   0 if v1 === v2
 *   1 if v1 > v2
 * Throws an Error if either version is invalid.
 */
export function compareSemver(v1: string, v2: string): number {
  const parsed1 = parseSemver(v1);
  const parsed2 = parseSemver(v2);

  if (!parsed1) {
    throw new Error(`Invalid semantic version: ${v1}`);
  }
  if (!parsed2) {
    throw new Error(`Invalid semantic version: ${v2}`);
  }

  if (parsed1.major !== parsed2.major) {
    return parsed1.major < parsed2.major ? -1 : 1;
  }

  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor < parsed2.minor ? -1 : 1;
  }

  if (parsed1.patch !== parsed2.patch) {
    return parsed1.patch < parsed2.patch ? -1 : 1;
  }

  // Pre-release comparison:
  // A normal version (no prerelease) has higher precedence than a prerelease version.
  const p1 = parsed1.prerelease;
  const p2 = parsed2.prerelease;

  if (!p1 && !p2) {
    return 0;
  }
  if (!p1 && p2) {
    return 1;
  }
  if (p1 && !p2) {
    return -1;
  }

  // Both have prereleases: compare identifiers pairwise
  const len = Math.max(p1!.length, p2!.length);
  for (let i = 0; i < len; i++) {
    const id1 = p1![i];
    const id2 = p2![i];

    if (id1 === undefined) {
      // Shorter prerelease set has lower precedence
      return -1;
    }
    if (id2 === undefined) {
      return 1;
    }

    const cmp = compareIdentifiers(id1, id2);
    if (cmp !== 0) {
      return cmp;
    }
  }

  return 0;
}

/**
 * Checks whether `currentVersion` satisfies the optional `minVersion` and `maxVersion` bounds.
 * If minVersion is given, currentVersion must be >= minVersion.
 * If maxVersion is given, currentVersion must be <= maxVersion.
 * Returns true if both bounds are satisfied (or omitted).
 * Returns false if version parsing fails or any bound is violated.
 */
export function satisfiesSemver(
  currentVersion: string,
  minVersion?: string | null,
  maxVersion?: string | null,
): boolean {
  if (!parseSemver(currentVersion)) {
    return false;
  }

  if (minVersion) {
    if (!parseSemver(minVersion)) {
      return false;
    }
    if (compareSemver(currentVersion, minVersion) < 0) {
      return false;
    }
  }

  if (maxVersion) {
    if (!parseSemver(maxVersion)) {
      return false;
    }
    if (compareSemver(currentVersion, maxVersion) > 0) {
      return false;
    }
  }

  return true;
}
