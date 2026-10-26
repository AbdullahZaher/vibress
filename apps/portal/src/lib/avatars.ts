export const MEMBER_AVATAR_KEYS = [
  "atlas",
  "aurora",
  "canyon",
  "coral",
  "default",
  "dune",
  "eclipse",
  "forest",
  "glacier",
  "harbor",
  "lagoon",
  "meadow",
  "nomad",
  "pearl",
  "sahara",
  "skyway",
  "summit",
  "sunset",
] as const;

export type MemberAvatarKey = (typeof MEMBER_AVATAR_KEYS)[number];

export interface AvatarItem {
  key: MemberAvatarKey;
  name: string;
  url: string;
}

export const AVATAR_REGISTRY: readonly AvatarItem[] = [
  { key: "default", name: "Default", url: "/avatars/default.svg" },
  { key: "atlas", name: "Atlas", url: "/avatars/atlas.svg" },
  { key: "aurora", name: "Aurora", url: "/avatars/aurora.svg" },
  { key: "canyon", name: "Canyon", url: "/avatars/canyon.svg" },
  { key: "coral", name: "Coral", url: "/avatars/coral.svg" },
  { key: "dune", name: "Dune", url: "/avatars/dune.svg" },
  { key: "eclipse", name: "Eclipse", url: "/avatars/eclipse.svg" },
  { key: "forest", name: "Forest", url: "/avatars/forest.svg" },
  { key: "glacier", name: "Glacier", url: "/avatars/glacier.svg" },
  { key: "harbor", name: "Harbor", url: "/avatars/harbor.svg" },
  { key: "lagoon", name: "Lagoon", url: "/avatars/lagoon.svg" },
  { key: "meadow", name: "Meadow", url: "/avatars/meadow.svg" },
  { key: "nomad", name: "Nomad", url: "/avatars/nomad.svg" },
  { key: "pearl", name: "Pearl", url: "/avatars/pearl.svg" },
  { key: "sahara", name: "Sahara", url: "/avatars/sahara.svg" },
  { key: "skyway", name: "Skyway", url: "/avatars/skyway.svg" },
  { key: "summit", name: "Summit", url: "/avatars/summit.svg" },
  { key: "sunset", name: "Sunset", url: "/avatars/sunset.svg" },
];

export function isMemberAvatarKey(value: unknown): value is MemberAvatarKey {
  return typeof value === "string" && (MEMBER_AVATAR_KEYS as readonly string[]).includes(value);
}

export function resolveDeterministicAvatar(seed: string): MemberAvatarKey {
  if (!seed || typeof seed !== "string") return "default";
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
  }
  const index = Math.abs(hash) % MEMBER_AVATAR_KEYS.length;
  return MEMBER_AVATAR_KEYS[index] ?? "default";
}

export function getAvatarUrl(avatarKey?: string | null, fallbackSeed?: string): string {
  if (isMemberAvatarKey(avatarKey)) {
    return `/avatars/${avatarKey}.svg`;
  }
  if (fallbackSeed) {
    const key = resolveDeterministicAvatar(fallbackSeed);
    return `/avatars/${key}.svg`;
  }
  return "/avatars/default.svg";
}
