import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("a retained collaborative root wins over a remounted database restore: the host must gate restoration", () => {
  const probe = resolve("packages/studio-react/src/__tests__/fixtures/collaborative-restore.cjs");
  const output = execFileSync(process.execPath, ["--import", "tsx", probe], { encoding: "utf8" });
  expect(JSON.parse(output)).toEqual({ before: "Existing collaborative content", after: "Existing collaborative content" });
});
