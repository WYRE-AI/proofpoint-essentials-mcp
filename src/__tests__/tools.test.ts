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
  "proofpoint_essentials_org_block_list_remove",
  "proofpoint_essentials_org_allow_list_add",
  "proofpoint_essentials_org_allow_list_remove",
  "proofpoint_essentials_users_block_list_remove",
  "proofpoint_essentials_users_allow_list_add",
  "proofpoint_essentials_users_allow_list_remove",
];

describe("TOOLS surface", () => {
  it("has 28 tools", () => {
    expect(TOOLS.length).toBe(28);
  });

  it("never describes a tool as SAFE", () => {
    for (const tool of TOOLS) expect(tool.description).not.toMatch(/\bSAFE\b/i);
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

  it("users_create advertises Proofpoint user fields and requires primary_email", () => {
    const tool = TOOLS.find((t) => t.name === "proofpoint_essentials_users_create")!;
    expect(tool.inputSchema.properties!.users).toMatchObject({
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["primary_email"],
        additionalProperties: true,
        properties: {
          primary_email: { type: "string" },
          firstname: { type: "string" },
          surname: { type: "string" },
        },
      },
    });
    const users = tool.inputSchema.properties!.users as {
      items: { properties: Record<string, unknown> };
    };
    for (const field of [
      "email", "lastname", "uid", "password", "creation_date", "last_update", "last_login",
    ]) {
      expect(users.items.properties).not.toHaveProperty(field);
    }
  });

  it("domains_create requires a non-empty string array", () => {
    const tool = TOOLS.find((t) => t.name === "proofpoint_essentials_domains_create")!;
    expect(tool.inputSchema.properties!.domains).toMatchObject({
      type: "array", items: { type: "string" }, minItems: 1,
    });
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

describe("sender-list tools", () => {
  const groups = [
    { scope: "org", anchor: "proofpoint_essentials_org_delete" },
    { scope: "users", anchor: "proofpoint_essentials_users_delete" },
  ];
  const variants = [
    { list: "block", action: "add" },
    { list: "block", action: "remove" },
    { list: "allow", action: "add" },
    { list: "allow", action: "remove" },
  ];

  for (const { scope, anchor } of groups) {
    variants.forEach(({ list, action }, offset) => {
      const name = `proofpoint_essentials_${scope}_${list}_list_${action}`;
      const routine = list === "block" && action === "add";
      describe(name, () => {
        const tool = () => TOOLS.find((t) => t.name === name)!;

        it("sits directly after the delete tool of its resource, in block/allow add/remove order", () => {
          expect(TOOL_NAMES.indexOf(name)).toBe(TOOL_NAMES.indexOf(anchor) + 1 + offset);
        });

        it("takes orgDomain, email (users only) and 1-100 bounded entries, with no list argument", () => {
          const { properties, required } = tool().inputSchema;
          expect(Object.keys(properties!).sort()).toEqual(
            scope === "users" ? ["email", "entries", "orgDomain"] : ["entries", "orgDomain"]
          );
          expect([...required!].sort()).toEqual(Object.keys(properties!).sort());
          expect(properties!.entries).toMatchObject({
            type: "array", minItems: 1, maxItems: 100,
            items: { type: "string", minLength: 1, maxLength: 320 },
          });
        });

        if (routine) {
          it("is a plain, idempotent, non-destructive write for unattended automation", () => {
            expect(tool().annotations).toEqual({
              readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
            });
            expect(tool().description).not.toContain("⚠");
            expect(tool().description).not.toContain("Confirm with the user");
            expect(tool().description).toContain("block list only");
            expect(tool().description).toContain("allow list");
          });
        } else {
          it("is Tier B high-impact with a stated reason", () => {
            expect(tool().annotations).toEqual({
              readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true,
            });
            expect(tool().description).toMatch(/^⚠ HIGH-IMPACT\./);
            expect(tool().description).toMatch(/Confirm with the user before invoking\.$/);
            expect(tool().description).toMatch(/bypass spam filtering|re-admits a blocked sender|back through filtering/);
          });
        }
      });
    });
  }

  it("replaces the old list-argument tools", () => {
    expect(TOOL_NAMES.filter((name) => name.includes("sender_list"))).toEqual([]);
  });

  it("users_update description points at the list tools and says it read-merges", () => {
    const description = TOOLS.find((t) => t.name === "proofpoint_essentials_users_update")!.description;
    expect(description).toMatch(/^⚠ HIGH-IMPACT\./);
    expect(description).toMatch(/Confirm with the user before invoking\.$/);
    expect(description).toContain("merges");
    expect(description).toContain("block/allow list tools");
  });
});
