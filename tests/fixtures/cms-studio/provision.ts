import crypto from "node:crypto";
import {
  eq,
  getDb,
  inArray,
  pages,
  posts,
  publicationMemberships,
  publications,
  revisions,
  roles,
  searchDocuments,
  userRoles,
  users,
  workspaces,
} from "@vibress/database";
import { hashPassword } from "@vibress/security";
import {
  loadCmsStudioFixturePack,
  type CmsStudioFixturePack,
  type CmsStudioFixturePublicationKey,
} from "./fixture-pack";

/** Synthetic credential for the isolated fixture accounts; never a real secret. */
export const CMS_STUDIO_FIXTURE_PASSWORD = "PinnedFixture-Only-1!";

export const CMS_STUDIO_FIXTURE_WORKSPACE_ID = "ws_default";

type FixtureDatabase = ReturnType<typeof getDb>;

export interface ProvisionedCmsStudioFixturePublication {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string;
}

export interface ProvisionedCmsStudioFixtureStaff {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface ProvisionedCmsStudioFixtureContent {
  readonly id: string;
  readonly kind: "post" | "page";
  readonly title: string;
  readonly slug: string;
}

export interface ProvisionedCmsStudioFixture {
  readonly runId: string;
  readonly publications: Record<
    CmsStudioFixturePublicationKey,
    ProvisionedCmsStudioFixturePublication
  >;
  readonly staff: Record<CmsStudioFixturePublicationKey, ProvisionedCmsStudioFixtureStaff>;
  readonly content: Readonly<Record<string, ProvisionedCmsStudioFixtureContent>>;
}

interface FixtureIdentities {
  readonly publicationIds: Record<CmsStudioFixturePublicationKey, string>;
  readonly userIds: Record<CmsStudioFixturePublicationKey, string>;
  readonly contentIds: Record<string, string>;
}

function buildIdentities(pack: CmsStudioFixturePack): FixtureIdentities {
  const publicationIds = {} as Record<CmsStudioFixturePublicationKey, string>;
  const userIds = {} as Record<CmsStudioFixturePublicationKey, string>;
  for (const publication of pack.publications) {
    publicationIds[publication.key] = `pub_fixture_${publication.key}_${crypto.randomUUID().slice(0, 8)}`;
    userIds[publication.key] = crypto.randomUUID();
  }
  const contentIds = Object.fromEntries(
    pack.content.map((entry) => [entry.key, crypto.randomUUID()]),
  );
  return { publicationIds, userIds, contentIds };
}

async function removeFixtureRows(
  db: FixtureDatabase,
  publicationIds: readonly string[],
  userIds: readonly string[],
  contentIds: readonly string[],
): Promise<void> {
  if (contentIds.length > 0) {
    await db.delete(revisions).where(inArray(revisions.resourceId, [...contentIds]));
  }
  for (const publicationId of publicationIds) {
    await db.delete(posts).where(eq(posts.publicationId, publicationId));
    await db.delete(pages).where(eq(pages.publicationId, publicationId));
    await db.delete(searchDocuments).where(eq(searchDocuments.publicationId, publicationId));
    await db.delete(publicationMemberships).where(
      eq(publicationMemberships.publicationId, publicationId),
    );
  }
  for (const publicationId of publicationIds) {
    await db.delete(publications).where(eq(publications.id, publicationId));
  }
  for (const userId of userIds) {
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
  }
  for (const userId of userIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
}

/**
 * Seeds the pinned pack into two synthetic publications in the shared dev
 * database. Every identity is run-scoped; teardown removes exactly those rows.
 */
export async function provisionCmsStudioFixturePack(
  runId: string,
  db: FixtureDatabase = getDb(),
): Promise<ProvisionedCmsStudioFixture> {
  const pack = loadCmsStudioFixturePack();
  const identities = buildIdentities(pack);
  const publicationIds = Object.values(identities.publicationIds);
  const staffUserIds = Object.values(identities.userIds);
  const contentIds = Object.values(identities.contentIds);

  try {
    const existingWorkspace = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, CMS_STUDIO_FIXTURE_WORKSPACE_ID));
    if (existingWorkspace.length === 0) {
      await db.insert(workspaces).values({
        id: CMS_STUDIO_FIXTURE_WORKSPACE_ID,
        name: "Default Workspace",
        slug: "default",
      });
    }

    await db.insert(publications).values(
      pack.publications.map((publication) => ({
        id: identities.publicationIds[publication.key],
        workspaceId: CMS_STUDIO_FIXTURE_WORKSPACE_ID,
        name: publication.name,
        slug: `${publication.slugBase}-${runId}`,
        domain: `${runId}.${publication.domainBase}`,
        primaryLocale: publication.primaryLocale,
      })),
    );

    const passwordHash = await hashPassword(CMS_STUDIO_FIXTURE_PASSWORD);
    await db.insert(users).values(
      pack.publications.map((publication) => ({
        id: identities.userIds[publication.key],
        email: `${publication.staff.emailBase}.${runId}@fixture.vibress.test`,
        name: publication.staff.name,
        passwordHash,
        status: "active" as const,
      })),
    );

    const [ownerRole] = await db.select().from(roles).where(eq(roles.key, "owner"));
    if (!ownerRole) {
      throw new Error("Fixture provisioning requires the seeded owner role.");
    }
    await db.insert(userRoles).values(
      pack.publications.map((publication) => ({
        userId: identities.userIds[publication.key],
        roleId: ownerRole.id,
      })),
    );

    await db.insert(publicationMemberships).values(
      pack.publications.map((publication) => ({
        id: crypto.randomUUID(),
        publicationId: identities.publicationIds[publication.key],
        userId: identities.userIds[publication.key],
        role: "owner",
      })),
    );

    for (const entry of pack.content) {
      const userId = identities.userIds[entry.publicationKey];
      const common = {
        id: identities.contentIds[entry.key]!,
        publicationId: identities.publicationIds[entry.publicationKey],
        title: entry.title,
        slug: `${entry.slugBase}-${runId}`,
        content: entry.document,
        primaryAuthorId: userId,
        createdBy: userId,
        updatedBy: userId,
      };
      if (entry.kind === "post") {
        await db.insert(posts).values(common);
      } else {
        await db.insert(pages).values(common);
      }
    }
  } catch (error) {
    try {
      await removeFixtureRows(db, publicationIds, staffUserIds, contentIds);
    } catch {
      // Preserve the original provisioning failure.
    }
    throw error;
  }

  const resultPublications = {} as ProvisionedCmsStudioFixture["publications"];
  const resultStaff = {} as ProvisionedCmsStudioFixture["staff"];
  const resultContent: Record<string, ProvisionedCmsStudioFixtureContent> = {};
  for (const publication of pack.publications) {
    resultPublications[publication.key] = {
      id: identities.publicationIds[publication.key],
      name: publication.name,
      slug: `${publication.slugBase}-${runId}`,
      domain: `${runId}.${publication.domainBase}`,
    };
    resultStaff[publication.key] = {
      userId: identities.userIds[publication.key],
      email: `${publication.staff.emailBase}.${runId}@fixture.vibress.test`,
      name: publication.staff.name,
    };
  }
  for (const entry of pack.content) {
    resultContent[entry.key] = {
      id: identities.contentIds[entry.key]!,
      kind: entry.kind,
      title: entry.title,
      slug: `${entry.slugBase}-${runId}`,
    };
  }

  return {
    runId,
    publications: resultPublications,
    staff: resultStaff,
    content: resultContent,
  };
}

export async function teardownCmsStudioFixturePack(
  fixture: ProvisionedCmsStudioFixture,
  db: FixtureDatabase = getDb(),
): Promise<void> {
  await removeFixtureRows(
    db,
    [fixture.publications.primary.id, fixture.publications.secondary.id],
    [fixture.staff.primary.userId, fixture.staff.secondary.userId],
    Object.values(fixture.content).map((entry) => entry.id),
  );
}
