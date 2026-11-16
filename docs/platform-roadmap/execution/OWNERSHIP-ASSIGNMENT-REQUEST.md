# Ownership assignment request (W1-T09 #29)

> **Status: OPEN — NO OWNER IS ASSIGNED BY THIS DOCUMENT.**
>
> This request names the **roles** that must sign the Wave 1 gates. It does not
> invent people, does not accept any ADR and does not change any gate to signed.
> The program remains **NO-GO** until named humans accept in writing.

## 1. Why this exists

Every blocking gate in
[BASELINE-AND-OWNERSHIP-M00.md](BASELINE-AND-OWNERSHIP-M00.md#4-ownership-and-decision-blockers-all-open)
is unassigned. Implementation evidence exists, but acceptance requires a human
accountable for each decision. Without named owners, "no objection" cannot be
distinguished from "nobody reviewed it".

## 2. Measured state (2026-11-14)

| Gate | Current state | Evidence |
| --- | --- | --- |
| ADR-PLAT-001/002/003 | **PROPOSED — unassigned** | [ADRs](adr/) |
| ADR-PLAT-004/005/006 | Not started (Waves 2+) | Baseline §4 |
| A1–A8 organizational sign-offs | **OPEN** | Baseline §4 |
| G0–G7 execution gates | **G0 not signed** | Baseline §4 |
| R26 PUBLIC EXECUTE | Inventory + approval request prepared; **not approved, not applied** | [approval request](R26-REVOCATION-APPROVAL-REQUEST.md) |
| R40 version identity | Decision record prepared; **Unresolved** | [decision record](R40-VERSION-IDENTITY-DECISION.md) |
| F-012 CMS RLS disposition | Proposed; **not accepted** | [decision record](F-012-CMS-RLS-DECISION.md) |
| Independent security review | **NOT PERFORMED** | [Wave 1 report](WAVE-01-IMPLEMENTATION-AND-SECURITY-REPORT.md) |

## 3. Required owner roles and signatures

The roles below are the minimum. One person may hold more than one role only if
the independent reviewer role remains independent of the implementation.

| # | Owner role | Must sign | Current |
| --- | --- | --- | --- |
| 1 | Executive/program sponsor | G0; A1–A8 business acceptance; Wave gate GO/NO-GO | **UNSIGNED** |
| 2 | Principal architect / architecture lead | ADR-PLAT-001, ADR-PLAT-002; architecture scope of ADR-PLAT-004/006/009 | **UNSIGNED** |
| 3 | DB/security lead | ADR-PLAT-002 (joint), ADR-PLAT-003; R26 Scope A/B decision; F-012 disposition | **UNSIGNED** |
| 4 | Release owner | ADR-PLAT-007/008; R40 option; release tags and publication decisions | **UNSIGNED** |
| 5 | Independent security reviewer | Independent review finding; G-series security gate | **UNSIGNED** |
| 6 | Platform implementation owner (accountable engineer) | Evidence accuracy, runbook upkeep, remediation of review findings | **UNASSIGNED** |
| 7 | Privacy/data-lifecycle owner | ADR-PLAT-010 (Wave 3+) | **NOT REQUESTED** |
| 8 | Plugin lead | ADR-PLAT-006 (Wave 2+) | **NOT REQUESTED** |

Role 6 is accountability for the evidence, not a substitute for roles 1–5.
No role above is satisfied by a CI result.

## 4. What each signature means

- **ADR signature:** the signer accepts the decision and its stated residual
  risks. It allows the ADR status to change from `PROPOSED` to `Accepted` in a
  separate, explicit edit.
- **G0 signature:** the execution gate may start from a reviewed baseline with
  assigned owners. It does not approve production launch.
- **R26 signature (Scope A):** approves applying the two trigger-function
  revocations and the default-privilege change to function creation, with the
  rollback in the proposal.
- **R26 signature (Scope B):** separately approves changing the legacy
  `provisionRuntimeRole` grants; this also needs the code companion described in
  the approval request.
- **R40 signature:** chooses Option A, B or C; only Option C authorizes a GA tag
  and publication.
- **F-012 signature:** accepts or rejects the proposed CMS RLS disposition; this
  is the launch-gate decision recorded in `SECURITY-REVIEW.md`.

## 5. How assignment becomes valid

1. A named human accepts the role and the specific decisions in writing (issue,
   PR comment, or signed change record).
2. The acceptance is recorded in the table in §3 with **name, role, date and the
   scope accepted**.
3. Only then may the corresponding ADR/gate status change, in a separate edit
   that cites the acceptance.
4. A role left blank stays unassigned; silence is not acceptance.

This repository does not contain the names, so none are written here.

## 6. Blocking consequences

Until roles 1–5 sign:

- Wave 1 remains **NO-GO** and Wave 2 must not start.
- ADR-PLAT-001/002/003 remain `PROPOSED`.
- R26 remains open; proposal `0055` stays outside the migration journal.
- No public hosting, tenant onboarding or release tag change is authorized.
- The runbook in
  [PLATFORM-BOOT-REGISTRY-RUNBOOK.md](PLATFORM-BOOT-REGISTRY-RUNBOOK.md) may be
  used for internal verification only.

## 7. What this request does not do

- It does not assign any person or imply consent.
- It does not accept ADRs or change gate status.
- It does not authorize R26 grant changes, a release tag, publication or
  production access.
- It does not modify `SECURITY-REVIEW.md` or any audit evidence.
