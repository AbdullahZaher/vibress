# AGENT.md — Vibress Agent Execution Rules

These instructions are mandatory for every coding task in the Vibress ecosystem.

Primary objective:

> **Deliver correct, production-quality changes with the minimum necessary
> exploration, commands, tests, and token usage.**

Speed matters.

Correctness, security, data integrity, architecture boundaries, and regression
safety must not be sacrificed for speed.

---

# 1. Default Execution Philosophy

Use:

```text
Understand narrowly
→ inspect relevant code
→ make focused change
→ run focused validation
→ continue
→ run full validation once at the final gate
```

Do NOT use:

```text
scan entire repository
→ run every test
→ inspect hundreds of unrelated files
→ make one tiny change
→ run every test again
→ repeat
```

Avoid unnecessary work.

---

# 2. Never Re-Analyze the Entire Repository

Do not repeatedly inspect the whole repository.

The Vibress architecture is already established.

Unless the task explicitly changes architecture, assume the documented
architecture remains authoritative.

For normal tasks, inspect only:

```text
directly affected package
direct dependencies
direct consumers
relevant tests
relevant documentation
```

Do not recursively read unrelated domains.

---

# 3. Read Documentation Selectively

Do not read all `docs/` for every task.

Read only documentation relevant to the requested batch or subsystem.

Example:

Media task:

```text
docs/03-domains/media*
docs/07-storage/*
docs/09-studio/*media*
docs/10-api/*media*
```

Do not automatically read every architecture document again.

---

# 4. Use Search Before Opening Files

Before manually opening many files:

use repository search tools.

Prefer targeted searches such as:

```bash
rg "MediaService|media_assets|MediaPicker" packages apps tests
```

instead of browsing directories file-by-file.

Use:

```text
rg
git grep
find with narrow paths
```

to locate implementation points quickly.

---

# 5. Do Not Dump Huge Files Unnecessarily

Never print entire large files unless the whole file is genuinely needed.

Prefer:

```bash
sed -n '120,220p' file.ts
```

or targeted search/context.

Read the smallest relevant code region first.

Expand only if necessary.

---

# 6. Batch File Inspection

When several related files are needed, inspect them together.

Bad:

```text
open file A
think
open file B
think
open file C
think
```

Preferred:

```text
identify A/B/C
read relevant sections together
form one implementation plan
edit together
```

Minimize tool round trips.

---

# 7. Do Not Re-Read Unchanged Files

Once a file has been inspected and not changed externally, do not repeatedly
reopen it unless:

```text
a later change affects its assumptions
a test failure points back to it
verification requires it
```

Use working memory.

---

# 8. Make a Focused Plan Once

For non-trivial tasks, create one short internal execution plan.

Example:

```text
1. schema
2. repository/service
3. API
4. UI
5. focused tests
6. final validation
```

Do not continually rewrite the plan.

Do not generate extensive planning documents before coding unless explicitly
requested.

---

# 9. Prefer Existing Patterns

Before inventing architecture, find one existing analogous implementation.

Example:

For a new API route, inspect one existing Vibress route with:

```text
auth
Zod validation
error mapping
audit
```

Then follow that pattern.

Do not study five different routes when one representative example is enough.

---

# 10. No Opportunistic Refactoring

Do not refactor unrelated code.

Do not:

```text
rename unrelated files
reformat entire packages
rewrite working abstractions
modernize unrelated dependencies
clean old warnings
reorganize directories
```

unless required to complete the task safely.

Keep diffs focused.

---

# 11. Fix Only Relevant Pre-Existing Problems

If an unrelated pre-existing warning/error is discovered:

document it.

Do not fix it unless:

```text
it blocks the requested task
or
the fix is trivial, safe, and directly adjacent
```

Never let a batch turn into repository cleanup.

---

# 12. Do Not Chase Existing Technical Debt

Known technical debt includes, unless explicitly scheduled otherwise:

```text
Nx + Next.js orchestration issue
Studio local file: package linking
existing lint warnings
```

Do not spend task time solving these.

---

# 13. Focused Tests During Development

During implementation, run only tests relevant to the current change.

Examples:

```bash
pnpm vitest packages/domains/media
```

or:

```bash
pnpm vitest apps/api/src/__tests__/media-upload.test.ts
```

or the repository's equivalent focused command.

Do not run the entire test suite after every edit.

---

# 14. Test Escalation Strategy

Use this escalation order:

```text
Level 1 — affected unit test
Level 2 — affected package/domain tests
Level 3 — affected integration tests
Level 4 — affected E2E scenario
Level 5 — full repository validation
```

Only escalate when the previous level passes or when the task reaches its final
verification gate.

---

# 15. Full Validation Only at Major Gates

For a normal batch, run the expensive full validation **once near completion**:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not repeatedly run this sequence during implementation.

Focused tests are sufficient during intermediate work.

---

# 16. Do Not Reinstall Dependencies Repeatedly

Do not run:

```bash
pnpm install
```

repeatedly.

Run dependency installation only when:

```text
starting from an uninstalled workspace
package.json/lockfile changed
final frozen-install verification is required
```

If dependencies have not changed, skip reinstalling during intermediate steps.

---

# 17. Dependency Changes Must Be Intentional

Before installing a new package:

1. verify an existing dependency cannot solve the problem;
2. verify Node/platform APIs cannot solve it cleanly;
3. install only the required dependency;
4. avoid broad utility packages for trivial functionality.

Do not update unrelated dependencies.

---

# 18. No Blind Dependency Upgrades

Never run broad upgrade commands such as:

```bash
pnpm update --latest
```

during a feature batch.

Upgrade only the specific package required by the task or a verified security
fix.

---

# 19. Avoid Unnecessary Builds

Do not run full production builds repeatedly.

During development prefer:

```text
typecheck
focused tests
affected app/package build
```

Run the full documented Vibress build at the final gate.

---

# 20. Avoid Unnecessary E2E Runs

Playwright is expensive.

During development:

run the specific spec or scenario being changed.

Example:

```bash
pnpm playwright test tests/e2e/media-flow.test.ts
```

Do not repeatedly run the complete E2E suite.

Run full E2E only at the final verification gate when required.

---

# 21. Use Existing Test Fixtures

Reuse existing:

```text
auth helpers
DB setup
factories
fixtures
API helpers
Playwright helpers
```

Do not rebuild test infrastructure for each task.

---

# 22. Do Not Over-Test Trivial Internals

Tests should protect behavior and important boundaries.

Do not create dozens of redundant tests for trivial getters, constants, or
framework behavior.

Prioritize:

```text
business rules
security boundaries
data integrity
state transitions
error behavior
cross-domain integration
```

---

# 23. Security Tests Are Never Optional

Speed optimizations must never skip relevant tests involving:

```text
authentication
authorization
tenant/user isolation
file uploads
path traversal
XSS
SQL injection
CSRF/origin protections
secret handling
payment/billing
data deletion
optimistic concurrency
```

Run focused security tests as soon as the relevant implementation is stable.

---

# 24. Database Safety Is Never Optional

For schema/migration changes always verify:

```text
migration compiles
migration applies
existing data path remains valid
constraints/indexes are correct
```

Do not repeatedly rebuild the database after every small edit.

Run focused migration validation when schema work stabilizes, then final
migration gates once.

---

# 25. Do Not Rewrite Existing Migrations

Never modify an already-established migration simply to simplify current work.

Create a new migration unless the project is explicitly still before that
migration's release boundary and the task says otherwise.

---

# 26. Avoid Database Reset Unless Necessary

Do not repeatedly:

```text
drop DB
recreate DB
reseed everything
```

Use isolated test databases or targeted cleanup.

Perform clean-migration verification only at the required gate.

---

# 27. Preserve Architecture Boundaries

Do not spend time debating already-established boundaries.

Canonical rules:

```text
business logic → domains
HTTP logic → API
database adapters → infrastructure/database
UI → no DB access
Studio → no Vibress Core internals
Media → Storage abstraction, not provider implementation
plugins → SDK/public contracts only
```

If an implementation violates one of these, correct it immediately.

---

# 28. Avoid Cross-Domain Deep Imports

Before adding a new import across domains, verify a public contract/use case
already exists.

Do not use internal file paths just because it is faster.

Short-term speed must not create architecture debt.

---

# 29. Keep Public APIs Small

Do not export implementation internals simply to make tests or another package
compile.

Expose only stable contracts required by consumers.

---

# 30. Prefer Minimal Correct Implementation

Implement exactly the required scope.

Do not add:

```text
future features
speculative abstractions
unused extension points
premature optimization
extra settings
new UI variants
```

unless the current batch explicitly requires them.

---

# 31. YAGNI Is Mandatory

If something belongs to a later batch, do not implement it now.

Examples:

```text
Batch 4 → no S3
Batch 5 → no billing
Media → no antivirus unless specifically scheduled
Studio → no collaboration unless scheduled
```

Document future extension points instead.

---

# 32. Do Not Build Placeholder Features

Do not add unfinished generic systems "for the future" unless required by an
established architecture contract.

Prefer a small correct interface over an elaborate unused framework.

---

# 33. Avoid Excessive Abstraction

Do not introduce:

```text
factory
manager
service
handler
adapter
registry
strategy
```

all at once for one simple operation.

Add abstraction only where there is a real boundary or multiple implementations.

---

# 34. Keep Changes Local

When possible, modify the smallest set of files.

Before changing a shared package, ask internally:

> Can this behavior be implemented within the owning domain/app without
> expanding global surface area?

Prefer yes when architecturally correct.

---

# 35. Avoid Formatting Noise

Do not run broad formatting tools over the repository.

Format only modified files if needed.

A code change should not produce hundreds of unrelated whitespace changes.

---

# 36. Preserve Existing Code Style

Follow nearby code patterns.

Do not introduce a new coding style inside an existing subsystem.

---

# 37. No Comment Spam

Add comments only for:

```text
non-obvious invariants
security decisions
cross-system constraints
intentional unusual behavior
```

Do not explain obvious TypeScript line-by-line.

---

# 38. Documentation Comes After Implementation

Do not spend significant time writing detailed docs before behavior is stable.

Recommended:

```text
implement
validate focused behavior
then update documentation
```

Architecture decisions that affect implementation may be noted briefly first.

---

# 39. Update Only Relevant Documentation

Do not rewrite the entire documentation tree.

Update only files directly affected by the task.

If current documentation is already accurate, leave it unchanged.

---

# 40. Do Not Produce Huge Intermediate Reports

During execution, do not continuously generate lengthy summaries.

Keep internal progress concise.

Final report should contain the required evidence only.

---

# 41. Prefer Machine Verification Over Re-Reading Code

After implementation:

use:

```text
typecheck
tests
lint
build
```

instead of repeatedly rereading every changed file manually.

Manual review is still required for sensitive/security-critical sections, but do
not duplicate mechanical checks.

---

# 42. Use Git Diff Efficiently

Before final validation inspect:

```bash
git diff --stat
git diff
```

or scoped equivalents.

Review the actual changed code once.

Do not repeatedly inspect every unchanged file.

---

# 43. Check Git Status Before and After

At task start:

```bash
git status --short
```

At task end:

```bash
git status --short
```

Distinguish:

```text
pre-existing user changes
Agent changes
generated artifacts
```

Never overwrite unrelated user work.

---

# 44. Do Not Commit or Push by Default

Unless the user explicitly requests it:

```text
do not git push
do not create PR
do not force push
```

Local commits may be created only when the task/workflow explicitly calls for
them.

Do not trigger remote CI after every batch unnecessarily.

---

# 45. CI Usage Must Be Economical

Do not rely on remote CI for routine development feedback.

Use focused local validation.

Full CI should normally run only:

```text
release gate
major integration gate
explicit user request
```

Avoid wasting CI minutes on intermediate changes.

---

# 46. Never Poll or Wait Unnecessarily

Do not repeatedly sleep/poll processes that can be checked directly.

When starting a service:

wait only until it is actually ready, then proceed.

Do not leave long-running watchers unless required.

---

# 47. Kill Temporary Processes

After runtime/E2E verification, stop processes started specifically for the test
if the normal development environment does not require them.

Avoid accumulating duplicate dev servers.

---

# 48. Reuse Running Infrastructure

If PostgreSQL/Redis/API are already healthy and correctly configured:

reuse them.

Do not restart Docker infrastructure unnecessarily.

Restart only the component whose configuration/code requires it.

---

# 49. Diagnose Failures Narrowly

When a test fails:

1. read the failing test/error;
2. identify likely responsible code;
3. run that specific test again after fixing.

Do not immediately rerun the entire suite.

---

# 50. Do Not Trial-and-Error Blindly

Do not make random code changes until tests pass.

Understand the failure first.

One reasoned fix is preferred over multiple speculative patches.

---

# 51. Stop Repeating the Same Failed Command

If a command fails twice for the same reason, investigate.

Do not execute the same expensive failing command repeatedly without a relevant
change.

---

# 52. Cache Awareness

Use Nx/pnpm/test caches where safe.

Do not disable caching without a concrete reason.

For final release-critical verification, use uncached execution only where the
task explicitly requires proof against stale cache.

---

# 53. Parallelize Independent Checks When Safe

Independent read-only checks may run in parallel, for example:

```text
lint
typecheck
independent audit
```

if the execution environment supports it safely.

Do not parallelize tests that contend for the same database, ports, migration
state, or filesystem fixtures unless designed for it.

Correctness takes priority over parallelism.

---

# 54. Token Efficiency

Keep reasoning and output concise.

Do not repeat:

```text
task description
architecture documentation
test results
known technical debt
```

multiple times.

Refer to established decisions rather than restating them.

---

# 55. Search Scope Must Be Explicit

Never run expensive unrestricted searches from `/` or the user's home directory.

Search only within the relevant repository/subdirectories.

---

# 56. Avoid Scanning Generated Directories

Exclude:

```text
node_modules
dist
build
.next
coverage
.git
tmp
test-results
playwright-report
```

from searches unless directly investigating generated output.

Example:

```bash
rg "pattern" apps packages tests docs \
  -g '!node_modules' \
  -g '!dist' \
  -g '!.next'
```

---

# 57. Never Inspect node_modules for Normal Tasks

Do not browse dependency source unless:

```text
documentation/types are insufficient
a confirmed dependency bug is being investigated
```

Prefer package docs/types first.

---

# 58. No Internet Research Unless Necessary

Do not browse external documentation for standard project code when local
types/docs are sufficient.

Use external research only for:

```text
unknown library behavior
security advisory verification
breaking API/version change
standards clarification
```

Do not research architecture the repository already defines.

---

# 59. One Representative Runtime Scenario First

For complex features, first make one end-to-end happy path work.

Then cover:

```text
error path
security path
edge case
```

Do not build every edge case before proving the basic integration.

---

# 60. But Never Ship Happy-Path Only

Before final PASS, required:

```text
error handling
security validation
failure cleanup
permissions
important regression tests
```

must be covered.

Speed applies to execution order, not quality criteria.

---

# 61. Avoid Premature Performance Benchmarking

Do not benchmark unless:

```text
performance is part of task
implementation is obviously pathological
batch definition explicitly requires it
```

Use reasonable complexity and move on.

---

# 62. Use Built-In Platform APIs Where Appropriate

Prefer stable Node/TypeScript APIs for straightforward functionality.

Do not install a package for:

```text
simple path operations
UUID if project already has an ID utility
basic hashing where Node crypto suffices
small collection helpers
```

---

# 63. Do Not Reimplement Security Libraries

The previous rule does NOT mean hand-writing complex security primitives.

Use established libraries for:

```text
password hashing
HTML sanitization
multipart parsing
JWT/crypto protocols where used
complex MIME parsing where required
```

---

# 64. Preserve Stable Interfaces

Do not unnecessarily change existing APIs/types just because another shape is
slightly cleaner.

If the current interface satisfies the task safely, extend minimally.

This reduces regression risk and implementation time.

---

# 65. Avoid Cascading Renames

Do not rename established concepts during feature work.

Renames create large diffs, test churn, documentation churn, and little product
value.

Schedule naming refactors separately.

---

# 66. Error Handling Must Stay Stable

Reuse existing Vibress error structure and codes.

Do not create a new error framework for each domain.

---

# 67. Logging Must Stay Focused

Do not add debug logging everywhere.

Add operational logs only when they materially assist production diagnosis.

Remove temporary debugging logs before completion.

---

# 68. Temporary Code Must Be Removed

Before final validation remove:

```text
console.log
debug endpoints
temporary fixtures
hard-coded credentials
temporary bypasses
TODO hacks created only for debugging
```

unless intentionally documented.

---

# 69. No Safety Bypasses to Make Tests Pass

Never:

```text
disable authorization
skip validation
weaken schema constraints
increase limits globally
ignore TypeScript errors
use @ts-ignore casually
mark failing tests skipped
```

to finish faster.

Fix the actual problem.

---

# 70. Do Not Change Tests to Match Broken Behavior

If implementation violates documented intended behavior, fix implementation.

Change tests only when:

```text
requirement changed
test is demonstrably incorrect
test asserts obsolete behavior
```

Document why.

---

# 71. Final Diff Review Is Mandatory

Before declaring completion:

review the complete scoped diff once.

Look specifically for:

```text
unintended files
debug code
absolute paths
secrets
generated files
architecture violations
unrelated formatting
```

---

# 72. Final Validation Strategy

At the end of a batch:

### Step A — focused final tests

Run affected domain/API/E2E/security tests.

### Step B — full project gate once

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

only once unless a failure requires a fix.

### Step C — relevant E2E

Run required E2E.

### Step D — final diff/status review.

Do not rerun successful expensive gates without a reason.

---

# 73. If Full Validation Fails

If final validation exposes a failure:

fix only that failure.

Then rerun:

```text
the failed gate
+
any directly dependent gates
```

Do not automatically rerun everything from the beginning.

After all failed gates are corrected, one final relevant confirmation is
sufficient.

---

# 74. Full CI / Release Validation

The development workflow intentionally minimizes CI usage.

During intermediate batches:

```text
focused local tests
local typecheck where needed
local commits if requested
```

At release/final integration gates:

```text
full CI
full test matrix
security audit
build
E2E
```

Do not trigger full remote CI repeatedly during every small batch.

---

# 75. Definition of Fast but Correct

A good Agent execution should usually look like:

```text
1. git status
2. targeted search
3. inspect 3–8 relevant files
4. implement focused changes
5. focused test
6. fix if needed
7. integration/E2E relevant test
8. documentation
9. final full validation once
10. git diff/status
11. concise report
```

Not:

```text
read 100 files
run 20 broad searches
run full tests 8 times
reinstall dependencies repeatedly
rebuild Docker repeatedly
rewrite unrelated docs
```

---

# 76. Escalation Rule

If a task unexpectedly requires significantly broader architecture changes than
requested:

do not silently expand scope.

First attempt the smallest safe solution compatible with current architecture.

If the broader change is genuinely unavoidable, clearly report it as a blocker
or architectural requirement.

---

# 77. Autonomous Decisions

Do not stop for trivial questions.

Use established project conventions and make reasonable implementation decisions
autonomously.

Do not ask the user to choose between equivalent low-level implementation
details.

Ask only when a decision materially affects:

```text
product behavior
data loss
security
public API compatibility
architecture direction
billing/cost
irreversible migration
```

---

# 78. Completion Standard

Do not confuse speed with incomplete work.

A task is complete only when:

```text
requested behavior implemented
focused tests pass
important error/security paths pass
architecture boundaries remain intact
documentation updated where required
final project gates pass
no unrelated changes introduced
```

---

# 79. Reporting Rules

Final report must be concise.

Include:

```text
status
what changed
tests actually run
important security/architecture result
new technical debt
blockers
files changed summary
```

Do not narrate every command executed.

Do not repeat the full task prompt.

---

# 80. Hard Prohibitions

Unless explicitly required, never:

```text
scan the entire repository multiple times
run full tests after each change
run full build after each change
run pnpm install repeatedly
reset the whole database repeatedly
restart all Docker services repeatedly
rewrite unrelated code
fix unrelated lint warnings
upgrade unrelated dependencies
add speculative abstractions
produce giant intermediate reports
push to GitHub
force-push
rewrite Git history
delete user work
skip security checks
skip required final validation
```

---

# 81. Priority Order

When trade-offs are necessary, use this priority:

```text
1. Correctness
2. Security
3. Data integrity
4. Architecture boundaries
5. Regression safety
6. Minimal scope
7. Execution speed
8. UI polish
```

Speed must come primarily from eliminating unnecessary work, not eliminating
required verification.

---

# 82. Vibress-Specific Working Rule

For each new Batch:

```text
During implementation:
    focused local tests only

At sub-feature completion:
    relevant package/integration tests

At Batch completion:
    full local validation once

At Release:
    full CI/security/release validation
```

This is the default Vibress workflow unless the batch prompt explicitly requires
stricter validation.

---

# 83. Final Instruction

Before executing any command, implicitly ask:

> **Will this command materially help implement, diagnose, or verify the
> requested change?**

If the answer is no:

**do not run it.**

Before opening any file, ask:

> **Is this file directly relevant to the current change or a
> dependency/consumer I must understand?**

If no:

**do not read it.**

Before adding any code, ask:

> **Is this required now?**

If no:

**do not add it.**

The goal is:

```text
minimum necessary work
+
maximum correctness
+
focused validation
=
fast Vibress development
```
