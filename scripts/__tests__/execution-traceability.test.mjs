// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATUSES,
  TOTAL_EPICS,
  buildRegistry,
  loadRegistry,
  parseMilestoneDocs,
  parseWaveDocs,
  renderMarkdownLedger,
  repoRootFromModule,
  summarize,
  validateLedger,
} from "../platform/execution/epic-ledger.mjs";

const repoRoot = repoRootFromModule();
const parsedWave = parseWaveDocs(repoRoot);
const parsedMilestones = parseMilestoneDocs(repoRoot);
const committed = loadRegistry(repoRoot);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function epicById(registry, id) {
  const epic = registry.epics.find((entry) => entry.id === id);
  if (!epic) throw new Error(`missing fixture Epic ${id}`);
  return epic;
}

describe("Epic execution traceability ledger (M00-E06)", () => {
  it("parses all 140 Epics from the five Wave checklists", () => {
    expect(parsedWave.issues).toEqual([]);
    expect(parsedWave.epics).toHaveLength(TOTAL_EPICS);
    expect(parsedWave.waveCounts).toEqual({
      "WAVE-01-M00-M02.md": 37,
      "WAVE-02-M03-M06.md": 42,
      "WAVE-03-M07-M08.md": 23,
      "WAVE-04-M09-M10.md": 18,
      "WAVE-05-M11-M12.md": 20,
    });
    expect(new Set(parsedWave.epics.map((epic) => epic.id)).size).toBe(TOTAL_EPICS);
  });

  it("matches the normative milestone specification Epic set exactly", () => {
    expect(parsedMilestones.issues).toEqual([]);
    expect(new Set(parsedMilestones.epics.keys())).toEqual(
      new Set(parsedWave.epics.map((epic) => epic.id)),
    );
  });

  it("validates the committed ledger with zero errors", () => {
    const { errors } = validateLedger(committed, parsedWave, parsedMilestones);
    expect(errors).toEqual([]);
  });

  it("keeps every status inside the directive vocabulary and closes nothing", () => {
    for (const epic of committed.epics) {
      expect(EXECUTION_STATUSES).toContain(epic.executionStatus);
      expect(epic.formallyClosed).toBe(false);
    }
    expect(summarize(committed).formallyClosedFraction).toBe("0/140");
  });

  it("regeneration preserves human evidence instead of resetting it", () => {
    const rebuilt = buildRegistry(parsedWave, parsedMilestones, committed);
    const m03 = epicById(rebuilt, "M03-E01");
    expect(m03.implementation.pullRequest).toBe(213);
    expect(m03.evidence.testNames.length).toBeGreaterThan(0);
    expect(m03.independentReview.verdict).toBe("CONDITIONAL");
  });

  it("refuses to close an Epic without pinned evidence", () => {
    const registry = clone(committed);
    // M01-E01 is an unimplemented Epic with no pinned implementation SHA.
    const epic = epicById(registry, "M01-E01");
    epic.executionStatus = "FORMALLY_CLOSED";
    epic.formallyClosed = true;
    const { errors } = validateLedger(registry, parsedWave, parsedMilestones);
    expect(errors).toEqual(
      expect.arrayContaining([
        "M01-E01: closure requires a pinned implementation SHA",
        "M01-E01: closure requires an independent ACCEPT verdict with URL",
        "M01-E01: closure requires recorded owner authorization with URL",
      ]),
    );
  });

  it("refuses to close a RESTRICTED-scope certification as the whole Epic", () => {
    const registry = clone(committed);
    const epic = epicById(registry, "M03-E01");
    epic.executionStatus = "FORMALLY_CLOSED";
    epic.formallyClosed = true;
    epic.implementation.codeSha = "a49d0379da06749ef5f163d9e48e9a053d2a375b";
    epic.evidence.ciRunUrls = ["https://github.com/AbdullahZaher/vibress/actions/runs/1"];
    epic.independentReview = {
      verdict: "ACCEPT",
      url: "https://github.com/AbdullahZaher/vibress/issues/197",
      reviewedSha: epic.implementation.codeSha,
    };
    epic.merge = { mergeSha: "b".repeat(40), mergedTo: "main" };
    epic.ownerAuthorization = {
      status: "AUTHORIZED",
      url: "https://github.com/AbdullahZaher/vibress/pull/213",
    };
    epic.blockers = [];
    const { errors } = validateLedger(registry, parsedWave, parsedMilestones);
    expect(errors).toEqual(
      expect.arrayContaining([
        "M03-E01: a RESTRICTED scope can never close the whole Epic",
        "M03-E01: assessment CERTIFIED_RESTRICTED is restricted and cannot close the Epic",
      ]),
    );
  });

  it("rejects an illegal execution status", () => {
    const registry = clone(committed);
    epicById(registry, "M01-E01").executionStatus = "DONE";
    const { errors } = validateLedger(registry, parsedWave, parsedMilestones);
    expect(errors).toContain("M01-E01: illegal executionStatus DONE");
  });

  it("rejects assessment drift from the checklist source", () => {
    const registry = clone(committed);
    epicById(registry, "M02-E01").assessment = "CERTIFIED_RESTRICTED";
    const { errors } = validateLedger(registry, parsedWave, parsedMilestones);
    expect(errors).toEqual(
      expect.arrayContaining([
        "M02-E01: assessment drift (ledger CERTIFIED_RESTRICTED, checklist PARTIAL); run --write",
      ]),
    );
  });

  it("rejects duplicate and invented progress metrics", () => {
    const registry = clone(committed);
    registry.epics.push(clone(registry.epics[0]));
    registry.percentComplete = 42;
    const { errors } = validateLedger(registry, parsedWave, parsedMilestones);
    expect(errors).toEqual(
      expect.arrayContaining([
        "M00-E01: duplicate ledger entry",
        "$.percentComplete: invented progress metrics are forbidden; record evidence instead",
      ]),
    );
  });

  it("renders a ledger with exact counts and no percentages", () => {
    const markdown = renderMarkdownLedger(committed);
    expect(markdown).toContain("Formally closed: 0/140");
    expect(markdown).toContain("| M12-E09 |");
    expect(markdown).not.toMatch(/\d+\s*%/);
  });
});
