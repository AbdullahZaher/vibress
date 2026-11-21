# M01 — External Consumer Certification Evidence

**Status:** engineering evidence only; no public package publication and no ownership sign-off.

## Packed contract proof

`node scripts/verify-external-consumer.mjs`:

- `npm pack` of `@vibress/platform-kernel` → tarball `vibress-platform-kernel-1.2.0.tgz`.
- Tarball extracted into a disposable consumer directory; `tsc --noEmit` against the public entry only.
- Consumer fixture declares custom action `approveDeal` and route `/crm/deals/:dealId/approve`.
- Zero private imports; no server start, database contact or hosting activation.
- Result: typecheck exit 0, proof errors empty (5/5 certification tests pass).

## Negative fixtures

`tests/architecture/m01-external-consumer-negative.test.ts` (7/7 pass) rejects:

1. private workspace source paths,
2. `@vibress/database`,
3. `@vibress/config`,
4. direct Fastify server imports,
5. relative sibling runtime imports,
and verifies the canonical fixture still exposes action + route contracts.

## Publication boundary

All packages remain `private: true` with TypeScript-source entries. Public registry publication and a built distributable artifact are **blocked on A2/G6**; this is recorded in `SDK-COMPATIBILITY-INVENTORY.json` and the capability matrix. No package was published or flag changed.

## Conclusion

The contract/packaging boundary is demonstrated for a local packed artifact. A genuinely published public SDK/CLI remains a future, authorized milestone (M07) dependency.
