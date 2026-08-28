/**
 * Handler tests against a stubbed ProofpointEssentialsClient. Elicitation is
 * exercised through the real MRTR helpers by passing an ElicitationContext: a
 * form-capable caller with no responses gets an `input_required` ask; a
 * retried request carries the answer in `inputResponses`; no context means no
 * elicitation (the stateless legacy fallback / non-interactive caller).
 */
import { describe, expect, it, vi } from "vitest";
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import { NotFoundError, ValidationError, type ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { CONFIRM_ARG, type ElicitationContext } from "../elicitation.js";
import { handleToolCall } from "../handlers/index.js";
import type { ToolResult } from "../handlers/results.js";

type Stub = Record<string, Record<string, ReturnType<typeof vi.fn>>>;

function stubClient(overrides: Stub = {}): ProofpointEssentialsClient {
  const base: Stub = {
    orgs: {
      get: vi.fn().mockResolvedValue({ id: 1, name: "Acme", primary_domain: "acme.com" }),
      setActive: vi.fn().mockResolvedValue({ id: 1, is_active: true }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    domains: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue([{ success: true }]),
      update: vi.fn().mockResolvedValue({ name: "sub.acme.com" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    users: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ email: "alice@acme.com" }),
      create: vi.fn().mockResolvedValue([{ success: true }]),
      update: vi.fn().mockResolvedValue({ email: "alice@acme.com" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    endpoints: {
      discover: vi.fn().mockResolvedValue({ domain: "acme.com", pod: "us1" }),
    },
    features: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    licensing: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    package: {
      update: vi.fn().mockResolvedValue({}),
    },
    reporting: {
      get: vi.fn().mockResolvedValue({}),
    },
    token: {
      create: vi.fn().mockResolvedValue({ token: "abc123" }),
    },
  };
  for (const [key, methods] of Object.entries(overrides)) {
    base[key] = { ...base[key], ...methods };
  }
  return base as unknown as ProofpointEssentialsClient;
}

const FORM_CAPABLE: ElicitationContext = { clientCapabilities: { elicitation: {} } };

/** A retried request carrying the user's accepted answer for `key`. */
function answered(key: string, content: Record<string, unknown>): ElicitationContext {
  return {
    clientCapabilities: { elicitation: {} },
    inputResponses: { [key]: { action: "accept", content } },
  };
}

/** Narrow a handler result to a plain tool result (i.e. not an MRTR ask). */
function asTool(result: ToolResult | InputRequiredResult): ToolResult {
  expect((result as { resultType?: string }).resultType).toBeUndefined();
  return result as ToolResult;
}

describe("unknown tool / invalid arguments / vendor errors", () => {
  it("unknown tool name → isError", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "not_a_real_tool", {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("missing required argument → isError, vendor never called", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "proofpoint_essentials_org_get", {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("domain");
    expect(client.orgs.get).not.toHaveBeenCalled();
  });

  it("ServiceError subclasses are formatted with status code and response", async () => {
    const client = stubClient({
      orgs: { get: vi.fn().mockRejectedValue(new NotFoundError("not found", { detail: "no such org" })) },
    });
    const result = asTool(
      await handleToolCall(client, "proofpoint_essentials_org_get", { domain: "missing.com" })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
    expect(result.content[0].text).toContain("no such org");
  });

  it("ValidationError formats cleanly even with an errors array on the instance", async () => {
    const client = stubClient({
      domains: {
        create: vi
          .fn()
          .mockRejectedValue(new ValidationError("invalid", [{ field: "domains", message: "required" }], {})),
      },
    });
    const result = asTool(
      await handleToolCall(client, "proofpoint_essentials_domains_create", {
        orgDomain: "acme.com",
        domains: ["new.com"],
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 422");
  });
});

describe("read handlers", () => {
  it("proofpoint_essentials_org_get calls orgs.get with the domain", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(client, "proofpoint_essentials_org_get", { domain: "acme.com" })
    );
    expect(result.isError).toBeUndefined();
    expect(client.orgs.get).toHaveBeenCalledWith("acme.com");
  });

  it("proofpoint_essentials_users_get calls users.get with orgDomain and email", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_users_get", {
      orgDomain: "acme.com",
      email: "alice@acme.com",
    });
    expect(client.users.get).toHaveBeenCalledWith("acme.com", "alice@acme.com");
  });

  it("proofpoint_essentials_endpoint_discover calls endpoints.discover", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_endpoint_discover", { domain: "acme.com" });
    expect(client.endpoints.discover).toHaveBeenCalledWith("acme.com");
  });

  it("proofpoint_essentials_reporting_get merges start/end/params and drops undefined", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_reporting_get", {
      orgDomain: "acme.com",
      start: "2026-01-01",
    });
    expect(client.reporting.get).toHaveBeenCalledWith("acme.com", {
      start: "2026-01-01",
      end: undefined,
    });
  });
});

describe("write handlers (non-destructive)", () => {
  it("proofpoint_essentials_domains_create passes through the domains array", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_domains_create", {
      orgDomain: "acme.com",
      domains: ["a.acme.com", "b.acme.com"],
    });
    expect(client.domains.create).toHaveBeenCalledWith("acme.com", ["a.acme.com", "b.acme.com"]);
  });

  it("proofpoint_essentials_users_create passes through the users array", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_users_create", {
      orgDomain: "acme.com",
      users: [{ email: "new@acme.com" }],
    });
    expect(client.users.create).toHaveBeenCalledWith("acme.com", [{ email: "new@acme.com" }]);
  });

  it("proofpoint_essentials_token_create passes an optional body through", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_token_create", {});
    expect(client.token.create).toHaveBeenCalledWith(undefined);
  });
});

describe("high-impact handlers (warning-only, no runtime gate)", () => {
  it("proofpoint_essentials_org_set_active calls orgs.setActive directly, no elicitation needed", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(client, "proofpoint_essentials_org_set_active", {
        domain: "acme.com",
        isActive: false,
      })
    );
    expect(result.isError).toBeUndefined();
    expect(client.orgs.setActive).toHaveBeenCalledWith("acme.com", false);
  });

  it("proofpoint_essentials_package_update calls package.update directly", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_package_update", {
      orgDomain: "acme.com",
      package: { tier: "premium" },
    });
    expect(client.package.update).toHaveBeenCalledWith("acme.com", { tier: "premium" });
  });
});

describe("delete confirmations (MRTR-safe: reads first, DELETE last)", () => {
  it("non-interactive caller without confirmation → blocked, DELETE never fires", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(client, "proofpoint_essentials_org_delete", { domain: "acme.com" })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(CONFIRM_ARG);
    expect(client.orgs.delete).not.toHaveBeenCalled();
  });

  it("every destructive tool blocks a non-interactive caller and proceeds with consent", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["proofpoint_essentials_org_delete", { domain: "acme.com" }],
      ["proofpoint_essentials_domains_delete", { orgDomain: "acme.com", domain: "sub.acme.com" }],
      ["proofpoint_essentials_users_delete", { orgDomain: "acme.com", email: "alice@acme.com" }],
    ];
    for (const [name, args] of calls) {
      const client = stubClient();
      const blocked = asTool(await handleToolCall(client, name, args));
      expect(blocked.isError, name).toBe(true);
      expect(blocked.content[0].text, name).toContain(CONFIRM_ARG);

      const proceeded = asTool(
        await handleToolCall(client, name, { ...args, [CONFIRM_ARG]: true })
      );
      expect(proceeded.isError, name).toBeUndefined();
    }
  });

  it("interactive caller with no prior response → returns an input_required ask, DELETE never fires", async () => {
    const client = stubClient();
    const result = await handleToolCall(
      client,
      "proofpoint_essentials_users_delete",
      { orgDomain: "acme.com", email: "alice@acme.com" },
      FORM_CAPABLE
    );
    expect((result as { resultType?: string }).resultType).toBe("input_required");
    expect(client.users.delete).not.toHaveBeenCalled();
  });

  it("interactive caller who declines (confirm: false) → cancelled, DELETE never fires", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(
        client,
        "proofpoint_essentials_users_delete",
        { orgDomain: "acme.com", email: "alice@acme.com" },
        answered("confirm", { confirm: false })
      )
    );
    expect(result.content[0].text).toContain("cancelled");
    expect(client.users.delete).not.toHaveBeenCalled();
  });

  it("interactive caller who confirms (confirm: true) → DELETE fires", async () => {
    const client = stubClient();
    const result = asTool(
      await handleToolCall(
        client,
        "proofpoint_essentials_domains_delete",
        { orgDomain: "acme.com", domain: "sub.acme.com" },
        answered("confirm", { confirm: true })
      )
    );
    expect(result.isError).toBeUndefined();
    expect(client.domains.delete).toHaveBeenCalledWith("acme.com", "sub.acme.com");
  });
});
