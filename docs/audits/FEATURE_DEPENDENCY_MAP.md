# Phase 2 — End-to-End Feature Dependency Map & Trace

**Timestamp:** 2026-09-14T09:28:10Z  
**Scope:** Forensic end-to-end tracing of suspicious, partial, orphaned, or high-value Admin features across the complete Vibress stack.

---

## 1. Feature Tracing Matrix

### Trace 1: The "Network" Phantom Feature
```text
Navigation:       AppSidebar (NavMain.tsx, line 35: <Share2 /> "Network")
  ↓
Route:            /admin/community
  ↓
React Component:  SettingsHub.tsx (initialSection="growth") [NOT a Network page!]
  ↓
Hook / State:     useSettingsHub() -> useGrowthSettings()
  ↓
API Client:       getSettingsApi(), updateSettingsApi()
  ↓
Fastify Route:    GET/PUT /api/admin/v1/settings
  ↓
Middleware:       requireStaffSession, requirePermission("settings.manage")
  ↓
Authorization:    hasPermission(userPermissions, "settings.manage", userRoles)
  ↓
Domain Service:   SettingsService
  ↓
Repository:       DrizzleSettingsRepository
  ↓
PostgreSQL:       site_settings table (key-value JSON settings)
  ↓
Missing Links:
  ❌ There is NO "Network" domain model.
  ❌ There is NO "Network" database table.
  ❌ There is NO "Network" API endpoint.
  ❌ There is NO ActivityPub social federation runtime or network graph.
  ❌ Clicking "Network" opens Growth Settings (newsletters and tracking).
```
**Conclusion:** "Network" is a purely orphaned, misleading navigation label that points to SettingsHub > Growth.

---

### Trace 2: Editorial Comments & Moderation Workflow
```text
Navigation:       AppSidebar (NavContent.tsx, line 236: <MessageSquare /> "Comments")
  ↓
Route:            /admin/community
  ↓
React Component:  SettingsHub.tsx (initialSection="growth") -> CommunityDiscussionsCard.tsx
  ↓
Broken Path:      CommunitySettings.tsx (containing CommentsPanel.tsx and ReportsPanel.tsx) is
                  completely UNMOUNTED in apps/admin/src/lib/router.tsx!
  ↓
Actual Working Backend (Disconnected from Primary Navigation):
  API Client:     listCommentsApi({ limit: 50 }), listCommentReportsApi({ limit: 50 })
  Fastify Routes: GET /api/admin/v1/comments, GET /api/admin/v1/comment-reports
                  POST /api/admin/v1/comments/:id/moderate
                  POST /api/admin/v1/comment-reports/:id/resolve
  Middleware:     requireStaffSession, requirePermission("comments.manage")
  Domain Service: CommentsService
  Repository:     DrizzleCommentRepository
  PostgreSQL:     comments table, comment_reports table
  Mutation:       Status update ('published' -> 'hidden' | 'deleted')
  Downstream:     Reader site hides moderated comments
```
**Missing Links:**
- A staff editor clicking "Comments" expects a moderation queue to review reported comments and approve/hide replies. Instead, they land on Growth Settings with only a toggle for "Who can comment".
- The full moderation UI (`CommunitySettings.tsx` + `CommentsPanel.tsx` + `ReportsPanel.tsx`) is fully coded and functional, but **orphaned** because router.tsx points `/admin/community` to `SettingsHub`.

---

### Trace 3: Publication Recommendations & Blogroll
```text
Navigation:       SettingsHub > Growth > RecommendationsCard.tsx
  ↓
Trigger:          "Manage" button opens SettingsModalPortal
  ↓
Hook / State:     Local useState (items, isCreating, title, url, desc)
  ↓
API Client:       listRecommendationsApi(), createRecommendationApi(), archiveRecommendationApi()
  ↓
Fastify Routes:   GET /api/admin/v1/recommendations
                  POST /api/admin/v1/recommendations
                  POST /api/admin/v1/recommendations/:id/archive
  ↓
Middleware:       requireStaffSession, requirePermission("recommendations.manage")
  ↓
Domain Service:   RecommendationsService (@vibress/recommendations)
  ↓
Repository:       DrizzleRecommendationRepository
  ↓
PostgreSQL:       recommendations table
  ↓
Mutation:         INSERT INTO recommendations, UPDATE recommendations SET status='archived'
  ↓
Downstream:
  Public API:     GET /api/public/v1/recommendations (Active recommendations list)
  Reader App:     apps/web has ZERO components or pages querying or rendering recommendations!
```
**Missing Links:**
- The admin workflow is 100% complete and persists to PostgreSQL.
- However, `apps/web` (the reader frontend) has no recommendations UI (e.g., sidebar blogroll or footer recommendations). The feature produces real database records that are not yet rendered on the public reader theme.

---

### Trace 4: Plugin Core Dynamic Execution (P0 Security Vulnerability)
```text
Invocation:       PluginsService.runPlugin(pluginId, event, data)
  ↓
Component:        packages/plugin-core/src/sandbox.ts
  ↓
Function:         executeSandboxedPluginCode(code, context, options)
  ↓
Runtime Engine:   import vm from "node:vm";
                  const vmContext = vm.createContext(sandboxContext);
                  const script = new vm.Script(code);
                  return script.runInContext(vmContext, { timeout: 2000 });
  ↓
Vulnerability:
  🚨 Node.js official documentation explicitly states: "The node:vm module is not a security
     sandbox. Do not use it to run untrusted code."
  🚨 Attackers or malicious plugin authors can use prototype traversal (`this.constructor.constructor('return process')()`)
     to break out of the VM context and gain full Remote Code Execution (RCE) on the host machine.
```
**Required Remediation:**
- Immediately remove dynamic `node:vm` evaluation.
- Restrict v1.x plugins strictly to bundled trusted plugins (`vibress-content-metrics`) loaded directly via compiled TypeScript modules.

---

### Trace 5: Collaboration CRDT Document State Exchange
```text
Invocation:       apps/admin PostEditor -> useYjsCollab (dormant) OR direct HTTP test
  ↓
HTTP Call:        POST /api/admin/v1/posts/:postId/collaboration/crdt
  ↓
Fastify Route:    apps/api/src/routes/collaboration.ts (line 292)
  ↓
Middleware:       requireStaffSession, requirePermission("posts.edit")
  ↓
Processing:       const { update } = req.body;
                  const updateBuffer = Buffer.from(update, "base64");
                  editorialCollaborationService.applyYjsDocUpdate(postId, new Uint8Array(updateBuffer));
  ↓
Domain Service:   EditorialCollaborationService -> in-memory Map<string, Y.Doc>
  ↓
Vulnerabilities & Missing Links:
  ⚠️ Payload size is unbounded: a client sending a 100 MB base64 string will exhaust Node memory (DoS).
  ⚠️ No schema validation or corrupted binary check: malformed base64 throws uncaught errors.
  ⚠️ No rate limiting: rapid POSTs cause CPU/memory starvation.
  ⚠️ Persistence: Updates are stored in an in-memory Map. Restarting the API server wipes all Yjs CRDT history.
  ⚠️ Real-time synchronization: There is no WebSocket gateway pushing updates to connected peers.
```
**Required Remediation:**
- Cap payload to 64 KB base64.
- Validate payload format safely with try/catch.
- Enforce per-user/per-post rate limits.
- Accurately document as durable CRDT state snapshot exchange, not real-time multi-cursor collaboration.

---

### Trace 6: Multi-Publication Tenancy Isolation
```text
Incoming Request: GET /api/admin/v1/posts
  ↓
Middleware:       requireStaffSession (resolves req.user, req.roles, req.permissions)
  ↓
Missing Step:     req.tenant is NEVER resolved or validated!
  ↓
Fastify Route:    fastify.get("/posts", async (req, reply) => {
                    const posts = await postsService.listPosts({}); // No publicationId passed!
                  })
  ↓
Domain Service:   PostsService.listPosts(filter)
  ↓
Repository:       DrizzlePostRepository.list(filter)
  ↓
PostgreSQL Query: SELECT * FROM posts WHERE ... (NO WHERE publication_id = ...)
  ↓
Data Bleed:
  🚨 In a multi-publication database, User in Publication A sees all posts from Publication B!
  🚨 posts, pages, media_assets, tags, members, newsletters, search_documents lack publication_id in schema!
```
**Required Remediation:**
- Add `publication_id` across all publication-owned tables via a clean migration.
- Establish canonical `req.tenant` resolution from authenticated staff session and membership.
- Enforce `publicationId` on all repository queries.

---

### Trace 7: Soft-Deleted Slug Collision Invariant
```text
Step 1: Create Post:   POST /api/admin/v1/posts -> { title: "Launch", slug: "launch" }
                       INSERT INTO posts (id, slug, ...) VALUES ('p1', 'launch', ...) -> SUCCESS
  ↓
Step 2: Soft Delete:   POST /api/admin/v1/posts/p1/delete
                       UPDATE posts SET deleted_at = NOW() WHERE id = 'p1' -> SUCCESS
  ↓
Step 3: Recreate Post: POST /api/admin/v1/posts -> { title: "Launch v2", slug: "launch" }
                       INSERT INTO posts (id, slug, ...) VALUES ('p2', 'launch', ...)
  ↓
Postgres Error:        ERROR: duplicate key value violates unique constraint "posts_slug_unique"
                       DETAIL: Key (slug)=(launch) already exists.
                       HTTP 500 / 409 error returned to admin UI!
```
**Required Remediation:**
- Drop unconditional `slug UNIQUE` constraints on `posts`, `pages`, and `tags`.
- Add partial composite unique indexes: `UNIQUE (publication_id, slug) WHERE deleted_at IS NULL`.
