import { describe, it, expect } from "vitest";
import { TOOLS, TOOL_NAMES } from "../tools.js";
import { CONFIRM_ARG } from "../elicitation.js";

const DESTRUCTIVE_TIER_A = [
  "proofpoint_essentials_org_delete",
  "proofpoint_essentials_domains_delete",
  "proofpoint_essentials_users_delete",
];

const HIGH_IMPACT_TIER_B = [
  "proofpoint_essentials_org_set_active",
  "proofpoint_essentials_domains_update",
  "proofpoint_essentials_users_update",
  "proofpoint_essentials_features_update",
  "proofpoint_essentials_licensing_update",
  "proofpoint_essentials_package_update",
];

describe("TOOLS surface", () => {
  it("has 20 tools", () => {
    expect(TOOLS.length).toBe(20);
  });

  it("has unique tool names", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOLS.length);
  });

  it("every tool name starts with the vendor prefix", () => {
    for (const tool of TOOLS) {
      expect(tool.name.startsWith("proofpoint_essentials_")).toBe(true);
    }
  });

  it("tools/list is deterministic by reference across calls", () => {
    expect(TOOLS).toBe(TOOLS);
  });

  describe("Tier A (irreversible destructive) tools", () => {
    for (const name of DESTRUCTIVE_TIER_A) {
      it(`${name} carries the destructive warning, annotations, and confirm arg`, () => {
        const tool = TOOLS.find((t) => t.name === name)!;
        expect(tool).toBeDefined();
        expect(tool.description).toContain("⚠ DESTRUCTIVE — IRREVERSIBLE.");
        expect(tool.description).toContain("Confirm with the user before invoking.");
        expect(tool.annotations?.readOnlyHint).toBe(false);
        expect(tool.annotations?.destructiveHint).toBe(true);
        expect(tool.annotations?.idempotentHint).toBe(false);
        expect(tool.inputSchema.properties![CONFIRM_ARG]).toBeDefined();
      });
    }
  });

  describe("Tier B (high-impact, reversible) tools", () => {
    for (const name of HIGH_IMPACT_TIER_B) {
      it(`${name} carries the high-impact warning and annotations, no confirm arg`, () => {
        const tool = TOOLS.find((t) => t.name === name)!;
        expect(tool).toBeDefined();
        expect(tool.description).toContain("⚠ HIGH-IMPACT.");
        expect(tool.description).toContain("Confirm with the user before invoking.");
        expect(tool.annotations?.destructiveHint).toBe(true);
        expect(tool.annotations?.idempotentHint).toBe(true);
        expect(tool.inputSchema.properties![CONFIRM_ARG]).toBeUndefined();
      });
    }
  });

  describe("read-only tools", () => {
    const readOnly = TOOLS.filter(
      (t) => ![...DESTRUCTIVE_TIER_A, ...HIGH_IMPACT_TIER_B].includes(t.name) && t.annotations?.readOnlyHint
    );

    it("has the expected set of read-only tools", () => {
      const names = readOnly.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "proofpoint_essentials_domains_list",
          "proofpoint_essentials_endpoint_discover",
          "proofpoint_essentials_features_get",
          "proofpoint_essentials_licensing_get",
          "proofpoint_essentials_org_get",
          "proofpoint_essentials_reporting_get",
          "proofpoint_essentials_users_get",
          "proofpoint_essentials_users_list",
        ].sort()
      );
    });

    it("carry no destructive warning or annotation", () => {
      for (const tool of readOnly) {
        expect(tool.description).not.toContain("⚠");
        expect(tool.annotations?.destructiveHint).toBeUndefined();
      }
    });
  });
});
