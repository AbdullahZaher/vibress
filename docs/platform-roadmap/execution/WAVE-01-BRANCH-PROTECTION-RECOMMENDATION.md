# Wave 1 — Branch Protection and Merge Authority Recommendation

> 2026-11-16, recommendation only. **No GitHub repository settings changed**; no merge or bypass authorized.

## Observed effective visibility

| Branch / rule | API result | Confidence / next action |
| --- | --- | --- |
| `main` | `protected:false`; repository rulesets list `[]` | No visible required review protection; repo admin must verify actual effective settings and bypass actors |
| `feat/wave1-platform-kernel-tenant-isolation` | `protected:false` | Unprotected as returned by branch API |
| `integration/wave1-agents-01-06-20261116` | PR #176 head exists; direct protection API for slash-encoded name rejected by connector | **UNKNOWN effective enforcement**; administrator export required |
| `main/protection` | HTTP 403 `Resource not accessible by integration` | **PERMISSION LIMITATION**; do not infer nonexistent branch restrictions solely from denied read |
| PR #166 | 5 COMMENTED, 0 APPROVED; 22 unresolved threads | No independent approved review; merging is blocked by release policy even if GitHub allows it |
| PR #176 | 0 submitted reviews, 0 threads | No independent approval; Draft and NO-GO |

## Proposed mandatory policy (owner/admin approval required)

1. Enable rulesets on `main`, `feat/wave1-platform-kernel-tenant-isolation`, and the integration branch/pattern; prevent direct pushes, force pushes, deletion and unauthorized branch/tag updates.
2. Require successful **exact-head** `build`, `e2e`, `container-scan`, `resource-isolation` and `reference-app-e2e` where workflows actually exist and are required by the affected change. Obtain current check context names and source app before configuring; do not invent nonexistent required checks or permit trivially spoofed statuses.
3. Require at least **one authorized independent reviewer** for security-sensitive changes, with CODEOWNERS for DB, AppSec, Infra and IAM, plus independent Agent 06 review of combined candidate. Author or last committer must not self-approve; dismiss stale approvals when new commits are pushed.
4. Require all review conversations resolved **after evidence-based disposition**. Require branch to be up-to-date or merge queue; validate actual checkout SHA when testing synthetic merge refs.
5. Restrict bypass/merge authority to a small, explicitly approved release-maintainer set; log all administrative bypasses, reason, ticket, timestamp, approver and post-action independent review. Prevent administrators from silently bypassing except documented break-glass.
6. Require signed/attested build artifact and immutable digest binding, least-privilege GitHub Actions permissions, pinned third-party Actions and dependency scanning. Scope deployment environments separately with protected reviewers and no unapproved production secrets.
7. Test rules with a disposable PR: missing check, stale approval, unresolved conversation, direct push, unapproved reviewer and admin bypass each must fail/record as intended. Attach rule export, test logs and settings diff to decision packet.

## Authorization request

**To Project Owner:** authorize a repository administrator to propose/apply the exact settings in a time-limited change, after assessing impacts on automation and CI. Repo admin must supply before/after rulesets export, rollback configuration, test results and a change log. This document **does not authorize application**.

Sources reviewed 2026-11-16: [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches); [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets); [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
