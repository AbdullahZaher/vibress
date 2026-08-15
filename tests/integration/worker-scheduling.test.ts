import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMigrations,
  seedDatabase,
  getDbPool,
  closeDbPool,
} from "@vibress/database";
import { DrizzleUserRepository, UsersService } from "@vibress/users";
import { DrizzleRoleRepository, RolesService } from "@vibress/roles";
import { DrizzleAuditRepository } from "@vibress/audit";
import {
  DrizzleRevisionRepository,
  RevisionsService,
} from "@vibress/revisions";
import { DrizzleAuthorRepository } from "@vibress/authors";
import { DrizzlePostRepository, PostsService } from "@vibress/posts";
import { ContentSchedulerWorker } from "../../apps/worker/src/scheduler";
import { hashPassword } from "@vibress/security";

describe("Worker Scheduled Publishing & Downtime Recovery", () => {
  let userRepo: DrizzleUserRepository;
  let roleRepo: DrizzleRoleRepository;
  let auditRepo: DrizzleAuditRepository;
  let revisionRepo: DrizzleRevisionRepository;
  let authorRepo: DrizzleAuthorRepository;
  let postRepo: DrizzlePostRepository;

  let usersService: UsersService;
  let rolesService: RolesService;
  let postsService: PostsService;
  let schedulerWorker: ContentSchedulerWorker;

  let testUser: any;

  beforeAll(async () => {
    await runMigrations();

    const pool = getDbPool();
    await pool.query(`
      TRUNCATE TABLE audit_events, sessions, role_permissions, user_roles, permissions, roles, revisions, post_tags, post_authors, page_authors, tags, pages, posts, users CASCADE;
    `);

    await seedDatabase();

    userRepo = new DrizzleUserRepository();
    roleRepo = new DrizzleRoleRepository();
    auditRepo = new DrizzleAuditRepository();
    revisionRepo = new DrizzleRevisionRepository();
    authorRepo = new DrizzleAuthorRepository();
    postRepo = new DrizzlePostRepository();

    usersService = new UsersService(userRepo);
    rolesService = new RolesService(roleRepo);

    const revisionsService = new RevisionsService(revisionRepo);
    postsService = new PostsService(
      postRepo,
      revisionsService,
      authorRepo,
      auditRepo,
    );

    const passHash = await hashPassword("WorkerPass123!");
    testUser = await usersService.createUser({
      email: "worker.admin@vibress.local",
      name: "Worker Admin",
      passwordHash: passHash,
    });
    const ownerRole = await rolesService.findByKey("owner");
    await rolesService.assignRoleToUser(testUser.id, ownerRole!.id);

    schedulerWorker = new ContentSchedulerWorker();
  }, 30000);

  afterAll(async () => {
    schedulerWorker.stop();
    await closeDbPool();
  });

  it("publishes scheduled post when scheduled timestamp arrives", async () => {
    const post = await postsService.createPost(
      { title: "Scheduled Post Test", primaryAuthorId: testUser.id },
      testUser.id,
    );

    const futureTime = new Date(Date.now() + 1000); // 1s in future
    await postsService.schedulePost(post.id, futureTime, testUser.id);

    const postBefore = await postsService.findById(post.id);
    expect(postBefore?.status).toBe("scheduled");

    // Run sweep before timestamp -> remains scheduled
    await schedulerWorker.runReconciliationSweep();
    const postMid = await postsService.findById(post.id);
    expect(postMid?.status).toBe("scheduled");

    // Wait until scheduled time passes
    await new Promise((res) => setTimeout(res, 1200));

    // Run sweep after timestamp -> published!
    await schedulerWorker.runReconciliationSweep();

    const postAfter = await postsService.findById(post.id);
    expect(postAfter?.status).toBe("published");
    expect(postAfter?.publishedAt).toBeDefined();
  });

  it("reconciles overdue scheduled posts after worker downtime recovery", async () => {
    const post = await postsService.createPost(
      { title: "Downtime Recovery Post", primaryAuthorId: testUser.id },
      testUser.id,
    );

    const futureTime = new Date(Date.now() + 500);
    await postsService.schedulePost(post.id, futureTime, testUser.id);

    // Worker is stopped (downtime)
    // Wait until scheduled time passes
    await new Promise((res) => setTimeout(res, 800));

    // Post is still in 'scheduled' status in DB while worker is offline
    const postDuringDowntime = await postsService.findById(post.id);
    if (postDuringDowntime?.status === "scheduled") {
      // Worker restarts and performs reconciliation sweep
      await schedulerWorker.runReconciliationSweep();
    }

    const postAfterRecovery = await postsService.findById(post.id);
    expect(postAfterRecovery?.status).toBe("published");
  });

  it("handles scheduled publishing idempotency cleanly", async () => {
    // Running sweep again when no posts are due performs zero mutations
    const result = await schedulerWorker.runReconciliationSweep();
    expect(result.publishedPostsCount).toBe(0);
    expect(result.publishedPagesCount).toBe(0);
  });
});
