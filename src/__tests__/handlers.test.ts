/**
 * Handler tests against a stubbed ProofpointEssentialsClient. Elicitation is
 * exercised through the real MRTR helpers by passing an ElicitationContext: a
 * form-capable caller with no responses gets an `input_required` ask; a
 * retried request carries the answer in `inputResponses`; no context means no
 * elicitation (the stateless legacy fallback / non-interactive caller).
 */
import { describe, expect, it, vi } from "vitest";
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import { NotFoundError, ValidationError, type BatchItemResult, type ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
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

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])(
    "inherited Object.prototype name %s is an unknown tool and leaks nothing",
    async (name) => {
      const client = Object.assign(stubClient(), {
        httpClient: { username: "dummy-user-PROBE", password: "dummy-password-PROBE" },
      });
      const result = asTool(await handleToolCall(client, name, {}));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool");
      expect(JSON.stringify(result)).not.toContain("dummy-");
    }
  );

  it("missing required argument → isError, vendor never called", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "proofpoint_essentials_org_get", {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("domain");
    expect(client.orgs.get).not.toHaveBeenCalled();
  });

  it("ServiceError subclasses retain status but omit vendor body", async () => {
    const client = stubClient({
      orgs: { get: vi.fn().mockRejectedValue(new NotFoundError("not found", { detail: "no such org" })) },
    });
    const result = asTool(
      await handleToolCall(client, "proofpoint_essentials_org_get", { domain: "missing.com" })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP 404");
    expect(result.content[0].text).not.toContain("no such org");
    expect(result.content[0].text).toContain('"statusCode":404');
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

  it("proofpoint_essentials_users_create passes equivalent user inputs", async () => {
    const client = stubClient();
    const users = [{ primary_email: "jdoe@example.com", firstname: "Jane", surname: "Doe" }];
    await handleToolCall(client, "proofpoint_essentials_users_create", {
      orgDomain: "acme.com",
      users,
    });
    expect(client.users.create).toHaveBeenCalledWith("acme.com", users);
    expect(vi.mocked(client.users.create).mock.calls[0][1]).toEqual(users);
  });

  it("strips response-only user fields without mutating caller objects", async () => {
    const client = stubClient();
    const input = {
      primary_email: "jane@acme.com", firstname: "Jane", surname: "Doe",
      custom: { value: "kept" },
    };
    const user = Object.freeze({
      ...input, uid: 123, password: "secret", creation_date: "today",
      last_update: "today", last_login: "today",
    });
    await handleToolCall(client, "proofpoint_essentials_users_create", {
      orgDomain: "acme.com", users: Object.freeze([user]),
    });
    expect(client.users.create).toHaveBeenCalledWith("acme.com", [input]);
    expect(user).toEqual({
      ...input, uid: 123, password: "secret", creation_date: "today",
      last_update: "today", last_login: "today",
    });
  });

  it.each([
    [{ email: "jdoe@example.com" }, "primary_email"],
    [{ email: "jdoe@example.com", lastname: "Doe" }, "surname"],
    [{ primary_email: "" }, "primary_email"],
    [{ primary_email: "   " }, "primary_email"],
    [{ primary_email: 123 }, "primary_email"],
  ])("rejects invalid user input %j before calling the SDK", async (user, hint) => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "proofpoint_essentials_users_create", {
      orgDomain: "acme.com",
      users: [{ primary_email: "valid@acme.com" }, user],
    }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("users[1].primary_email");
    expect(result.content[0].text).toContain(hint);
    if ("email" in user) expect(result.content[0].text).toContain('Use "primary_email" instead of "email"');
    if ("lastname" in user) expect(result.content[0].text).toContain('Use "surname" instead of "lastname"');
    expect(client.users.create).not.toHaveBeenCalled();
  });

  it("proofpoint_essentials_token_create passes an optional body through", async () => {
    const client = stubClient();
    await handleToolCall(client, "proofpoint_essentials_token_create", {});
    expect(client.token.create).toHaveBeenCalledWith(undefined);
  });
});

describe.each(["users", "domains"] as const)("%s create batch results", (resource) => {
  const cases: Array<{
    name: string;
    results: BatchItemResult[];
    submitted?: number;
    succeeded: number;
    failed: number;
    unconfirmed: number;
  }> = [
    {
      name: "missing successful response items",
      submitted: 3,
      results: [{ success: true, status: 201 }],
      succeeded: 1, failed: 0, unconfirmed: 2,
    },
    {
      name: "missing failed response items",
      submitted: 3,
      results: [{ success: false, status: 400, message: "bad" }],
      succeeded: 0, failed: 1, unconfirmed: 2,
    },
    {
      name: "over-return",
      submitted: 1,
      results: [{ success: true }, { status: 201 }],
      succeeded: 2, failed: 0, unconfirmed: 0,
    },
    {
      name: "all-success",
      results: [{ success: true, status: 201 }, { success: true }],
      succeeded: 2, failed: 0, unconfirmed: 0,
    },
    {
      name: "207-style mixed success and failure",
      results: [{ success: true, primary_email: "created@acme.com" },
        { success: false, status: 409, message: "exists" }],
      succeeded: 1, failed: 1, unconfirmed: 0,
    },
    {
      name: "explicit failure from a 201 response",
      results: [{ success: false, status: 400, message: "bad" }],
      succeeded: 0, failed: 1, unconfirmed: 0,
    },
    {
      name: "non-2xx code without a success flag",
      results: [{ code: 409, message: "exists" }],
      succeeded: 0, failed: 1, unconfirmed: 0,
    },
    {
      name: "non-2xx status without a success flag",
      results: [{ status: 400, message: "bad" }],
      succeeded: 0, failed: 1, unconfirmed: 0,
    },
    {
      name: "unconfirmed items",
      results: [{ primary_email: "unknown@acme.com" }, { message: "accepted" }],
      succeeded: 0, failed: 0, unconfirmed: 2,
    },
    {
      name: "2xx status without a success flag",
      results: [{ status: 201 }],
      succeeded: 1, failed: 0, unconfirmed: 0,
    },
    {
      name: "success flag contradicted by a non-2xx status",
      results: [{ success: true, status: 500, message: "partial" }],
      succeeded: 0, failed: 1, unconfirmed: 0,
    },
  ];
  it.each(cases)("$name", async ({ results, submitted = results.length, succeeded, failed, unconfirmed }) => {
    const original = structuredClone(results);
    const client = stubClient({
      [resource]: { create: vi.fn().mockResolvedValue(results) },
    });
    const result = asTool(await handleToolCall(
      client,
      `proofpoint_essentials_${resource}_create`,
      {
        orgDomain: "acme.com",
        users: Array.from({ length: submitted }, (_, index) => ({ primary_email: `user${index}@acme.com` })),
        domains: Array.from({ length: submitted }, (_, index) => `domain${index}.acme.com`),
      }
    ));
    expect(result.isError).toBe(failed > 0 ? true : undefined);
    const text = result.content[0].text;
    const payload = JSON.parse(failed > 0 ? text.slice(text.indexOf("\n\n") + 2) : text);
    expect(payload).toEqual({
      summary: { requested: Math.max(submitted, results.length), returned: results.length, succeeded, failed, unconfirmed },
      results: succeeded !== results.length || unconfirmed > 0 ? original.map((item, index) => ({
        index,
        outcome: item.success === false || [item.status, item.code].some(
          (code) => typeof code === "number" && (code < 200 || code >= 300)
        ) ? "failed" : item.success === true || typeof item.status === "number" || typeof item.code === "number"
          ? "succeeded" : "unconfirmed",
        ...(typeof item.status === "number" ? { status: item.status } : {}),
        ...(typeof item.code === "number" ? { code: item.code } : {}),
        ...(typeof item.message === "string" ? { message: item.message } : {}),
      })) : original,
    });
    expect(payload.summary.requested).toBe(succeeded + failed + unconfirmed);
    expect(results).toEqual(original);
    if (failed > 0) {
      expect(text).toContain(`${failed} of ${Math.max(submitted, results.length)}`);
      expect(text).toContain(`${succeeded} succeeded and should not be retried`);
      if (unconfirmed > 0) expect(text).toContain(`${unconfirmed} unconfirmed`);
      else expect(text.split("\n\n")[0]).not.toContain("unconfirmed");
    }
  });
  it.each(["message", "error", "detail", "reason", "description", "object error"])(
    "redacts personal fields and emails from %s",
    async (field) => {
      const message = "user jane.doe@acme.com already exists";
      const item = {
        success: false, status: 400, code: "ignored",
        primary_email: "jane.doe@acme.com", email: "private@acme.com",
        firstname: "JaneSecret", surname: "DoeSecret", lastname: "LastSecret",
        alias_emails: ["alias@acme.com"], name: "private-domain.acme.com",
        [field === "object error" ? "error" : field]: field === "object error" ? { message } : message,
      };
      const client = stubClient({ [resource]: { create: vi.fn().mockResolvedValue([item]) } });
      const result = asTool(await handleToolCall(client, `proofpoint_essentials_${resource}_create`, {
        orgDomain: "acme.com", users: [{ primary_email: "jane.doe@acme.com" }], domains: ["acme.com"],
      }));
      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      for (const secret of ["jane.doe@acme.com", "JaneSecret", "DoeSecret", "LastSecret", "primary_email", "private-domain.acme.com", "alias@acme.com"]) {
        expect(text).not.toContain(secret);
      }
      expect(JSON.parse(text.slice(text.indexOf("\n\n") + 2)).results).toEqual([
        { index: 0, outcome: "failed", status: 400, message: "user [redacted-email] already exists" },
      ]);
    }
  );

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

const SENDER_UNREADABLE = "Existing sender lists could not be read safely; refusing update.";

type ListsBehaviour = "merge" | "replace" | "ignore" | "drop-allow-list";

/**
 * A stateful fake of the sender-lists resource. "merge" and "replace" are the two
 * possible PATCH semantics; "ignore" drops the write; "drop-allow-list" merges
 * but also wipes the allow list.
 */
function senderListsClient(scope: "org" | "users", initial: unknown, behaviour: ListsBehaviour = "merge") {
  let state: unknown = structuredClone(initial);
  const listsIndex = scope === "users" ? 2 : 1;
  const get = vi.fn().mockImplementation(async () => structuredClone(state));
  const update = vi.fn().mockImplementation(async (...callArgs: unknown[]) => {
    const lists = structuredClone(callArgs[listsIndex]) as Record<string, unknown>;
    const current = state !== null && typeof state === "object" ? state : {};
    if (behaviour === "merge") state = { ...current, ...lists };
    else if (behaviour === "replace") state = lists;
    else if (behaviour === "drop-allow-list") state = { ...current, ...lists, allow_list: [] };
  });
  const client = stubClient({
    senderLists: scope === "users" ? { getUser: get, updateUser: update } : { getOrg: get, updateOrg: update },
  });
  return { client, get, update };
}

describe.each(["org", "users"] as const)("%s block/allow list tools", (scope) => {
  const target = { orgDomain: "example.com", ...(scope === "users" ? { email: "user@example.com" } : {}) };
  const prefix = scope === "users" ? ["example.com", "user@example.com"] : ["example.com"];
  async function run(
    client: ProofpointEssentialsClient, list: "block" | "allow", action: "add" | "remove",
    entries: unknown, extra: Record<string, unknown> = {}
  ) {
    return asTool(await handleToolCall(
      client, `proofpoint_essentials_${scope}_${list}_list_${action}`, { ...target, entries, ...extra }
    ));
  }
  const body = (result: ToolResult) => JSON.parse(result.content[0].text);

  describe.each(["merge", "replace"] as const)("PATCH behaves as %s", (behaviour) => {
    it("block add appends, sends both lists once, verifies, and leaves the allow list alone", async () => {
      const { client, get, update } = senderListsClient(scope, {
        allow_list: ["Keep@example.com"], block_list: ["old.example.com"],
      }, behaviour);
      const result = await run(client, "block", "add", ["new.example.com"]);
      expect(result.isError).toBeUndefined();
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(...prefix, {
        allow_list: ["Keep@example.com"], block_list: ["old.example.com", "new.example.com"],
      }, "PATCH");
      expect(get).toHaveBeenCalledTimes(2);
      expect(body(result)).toEqual({
        orgDomain: "example.com", ...(scope === "users" ? { email: "user@example.com" } : {}),
        list: "block", changed: true, verified: true,
        added: ["new.example.com"], skipped_already_present: [], also_on_allow_list: [],
        counts: { allow_list: 1, block_list: 2 },
        entries: ["old.example.com", "new.example.com"],
      });
      expect(client.users.update).not.toHaveBeenCalled();
      expect(client.orgs.delete).not.toHaveBeenCalled();
    });

    it("allow add appends to the allow list and leaves the block list alone", async () => {
      const { client, update } = senderListsClient(scope, {
        allow_list: [], block_list: ["Blocked.example.com"],
      }, behaviour);
      const result = await run(client, "allow", "add", ["ok@example.com"]);
      expect(update).toHaveBeenCalledWith(...prefix, {
        allow_list: ["ok@example.com"], block_list: ["Blocked.example.com"],
      }, "PATCH");
      expect(body(result)).toMatchObject({
        list: "allow", changed: true, verified: true, added: ["ok@example.com"],
        also_on_block_list: [], counts: { allow_list: 1, block_list: 1 }, entries: ["ok@example.com"],
      });
    });

    it("remove deletes every case variant from the target list only", async () => {
      const { client, update } = senderListsClient(scope, {
        allow_list: ["x@example.com"], block_list: ["x@example.com", "X@Example.com", "keep.example.com"],
      }, behaviour);
      const result = await run(client, "block", "remove", ["X@example.com", "missing.example.com"]);
      expect(update).toHaveBeenCalledWith(...prefix, {
        allow_list: ["x@example.com"], block_list: ["keep.example.com"],
      }, "PATCH");
      expect(body(result)).toEqual({
        orgDomain: "example.com", ...(scope === "users" ? { email: "user@example.com" } : {}),
        list: "block", changed: true, verified: true,
        removed: ["X@example.com"], skipped_not_present: ["missing.example.com"],
        counts: { allow_list: 1, block_list: 1 }, entries: ["keep.example.com"],
      });
    });
  });

  it("de-duplicates entries case-insensitively with the first spelling winning", async () => {
    const { client, update } = senderListsClient(scope, { allow_list: [], block_list: [] });
    const result = await run(client, "block", "add", ["A@example.com", "a@EXAMPLE.com", "b@example.com"]);
    expect(body(result).added).toEqual(["A@example.com", "b@example.com"]);
    expect(update.mock.calls[0][prefix.length]).toEqual({ allow_list: [], block_list: ["A@example.com", "b@example.com"] });
  });

  it("add skips entries already present (case-insensitive) and makes no write when nothing changes", async () => {
    const { client, get, update } = senderListsClient(scope, { allow_list: [], block_list: ["new@example.com"] });
    const result = await run(client, "block", "add", ["NEW@example.com"]);
    expect(result.isError).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
    const payload = body(result);
    expect(payload).toMatchObject({
      changed: false, added: [], skipped_already_present: ["NEW@example.com"],
      counts: { allow_list: 0, block_list: 1 }, entries: ["new@example.com"],
    });
    expect(payload).not.toHaveProperty("verified");
  });

  it("remove makes no write when no entry is present", async () => {
    const { client, update } = senderListsClient(scope, { allow_list: ["a@example.com"], block_list: [] });
    const result = await run(client, "allow", "remove", ["other@example.com"]);
    expect(update).not.toHaveBeenCalled();
    expect(body(result)).toMatchObject({
      changed: false, removed: [], skipped_not_present: ["other@example.com"],
    });
  });

  it("block add reports entries that are also on the allow list without changing it", async () => {
    const { client, update } = senderListsClient(scope, {
      allow_list: ["trusted@example.com"], block_list: [],
    });
    const result = await run(client, "block", "add", ["Trusted@example.com", "other@example.com"]);
    expect(update).toHaveBeenCalledWith(...prefix, {
      allow_list: ["trusted@example.com"], block_list: ["Trusted@example.com", "other@example.com"],
    }, "PATCH");
    expect(body(result)).toMatchObject({ also_on_allow_list: ["Trusted@example.com"], verified: true });
  });

  it("allow add reports entries that are also on the block list without changing it", async () => {
    const { client, update } = senderListsClient(scope, { allow_list: [], block_list: ["bad@example.com"] });
    const result = await run(client, "allow", "add", ["BAD@example.com"]);
    expect(update).toHaveBeenCalledWith(...prefix, {
      allow_list: ["BAD@example.com"], block_list: ["bad@example.com"],
    }, "PATCH");
    expect(body(result)).toMatchObject({ also_on_block_list: ["BAD@example.com"] });
  });

  it("treats an empty object as two empty lists and a single present list as the other being empty", async () => {
    const empty = senderListsClient(scope, {});
    expect(body(await run(empty.client, "block", "add", ["a.example.com"]))).toMatchObject({
      verified: true, counts: { allow_list: 0, block_list: 1 },
    });
    const partial = senderListsClient(scope, { block_list: ["b.example.com"] });
    expect(body(await run(partial.client, "block", "add", ["a.example.com"]))).toMatchObject({
      verified: true, counts: { allow_list: 0, block_list: 2 },
    });
  });

  it("returns entries only up to 100 and otherwise sets entries_omitted", async () => {
    const existing = Array.from({ length: 99 }, (_, i) => `d${i}.example.com`);
    const small = senderListsClient(scope, { allow_list: [], block_list: existing });
    const at100 = body(await run(small.client, "block", "add", ["extra.example.com"]));
    expect(at100.entries).toHaveLength(100);
    expect(at100).not.toHaveProperty("entries_omitted");
    const large = senderListsClient(scope, { allow_list: [], block_list: [...existing, "x.example.com"] });
    const at101 = body(await run(large.client, "block", "add", ["extra.example.com"]));
    expect(at101).not.toHaveProperty("entries");
    expect(at101).toMatchObject({ entries_omitted: true, counts: { allow_list: 0, block_list: 101 } });
  });

  describe("fails closed when the write cannot be confirmed", () => {
    it("reports an error when the target change is not visible on re-read", async () => {
      const { client, update } = senderListsClient(scope, { allow_list: [], block_list: [] }, "ignore");
      const result = await run(client, "block", "add", ["a.example.com"]);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("could not be confirmed");
      expect(result.content[0].text).toContain("a.example.com");
    });
    it("reports an error when a removed entry is still present", async () => {
      const { client } = senderListsClient(scope, { allow_list: ["a@example.com"], block_list: [] }, "ignore");
      const result = await run(client, "allow", "remove", ["a@example.com"]);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("could not be confirmed");
    });
    it("reports an error when the opposite list changed", async () => {
      const { client } = senderListsClient(scope, {
        allow_list: ["keep.example.com"], block_list: [],
      }, "drop-allow-list");
      const result = await run(client, "block", "add", ["a.example.com"]);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("could not be confirmed");
      expect(result.content[0].text).toContain("allow");
      expect(result.content[0].text).toContain("keep.example.com");
    });
    it("reports an error when the re-read is unreadable", async () => {
      const { client, get } = senderListsClient(scope, { allow_list: [], block_list: [] });
      get.mockResolvedValueOnce({ allow_list: [], block_list: [] }).mockResolvedValueOnce(null);
      const result = await run(client, "block", "add", ["a.example.com"]);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("could not be confirmed");
    });
  });

  describe("fails closed when the existing lists cannot be read safely", () => {
    it.each([
      ["null", null],
      ["a string", "lists"],
      ["an array", []],
      ["an object with unrelated keys", { error: "boom" }],
      ["a non-array allow_list", { allow_list: "a@example.com", block_list: [] }],
      ["a non-string entry", { allow_list: [], block_list: [1] }],
      ["a non-array block_list", { allow_list: [], block_list: { a: 1 } }],
    ])("%s", async (_name, initial) => {
      const { client, update } = senderListsClient(scope, initial);
      const result = await run(client, "block", "add", ["a.example.com"]);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(SENDER_UNREADABLE);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("entry validation", () => {
    const accepted = [
      "user@example.com", "example.com", "sub.example.co.uk", "*@example.com", "10.91.*.*",
      "192.168.1.*", "192.168.1.10", "192.168.1.0/24", "10.1.2.3/32", "a/b@example.com",
      "xn--bcher-kva.example", "a-b.example.com", "1.2.3.4.example.com",
    ];
    it.each(accepted)("accepts %s", async (entry) => {
      const { client, update } = senderListsClient(scope, { allow_list: [], block_list: [] });
      const result = await run(client, "block", "add", [entry]);
      expect(result.isError).toBeUndefined();
      expect(update).toHaveBeenCalledTimes(1);
    });

    const rejected: Array<[string, string]> = [
      ["*.*", "wildcard"], ["*@*.*", "wildcard"], ["*@*", "domain"], ["*.com", "wildcard"],
      ["*.co.uk", "wildcard"], ["*.example.com", "wildcard"], ["*@*.com", "wildcard"],
      ["a@*", "domain"], ["*@a", "domain"], ["*", "wildcard"], ["*.*.*.*", "wildcard"],
      ["10.*.*.*", "wildcard"], ["10.*.1.1", "wildcard"], ["256.1.1.*", "wildcard"],
      ["0.0.0.0/0", "larger than /24"], ["10.0.0.0/8", "larger than /24"], ["10.0.0.0/23", "larger than /24"],
      ["10.0.0.0/33", "prefix"], ["10.0.0.0/24/1", "CIDR"], ["10.0.0/24", "CIDR"], ["999.0.0.0/24", "CIDR"],
      ["2001:db8::1", "IPv6"], ["[::1]", "IPv6"], ["user@[2001:db8::1]", "IPv6"],
      ["a@b", "domain"], ["foo.123", "domain"], ["user@192.168.1.1", "domain"],
      ["999.999.999.999", "IPv4"], ["10.91", "IPv4"],
      ["a".repeat(64) + ".example.com", "label"], ["-a.example.com", "label"], ["a-.example.com", "label"],
      ["a..example.com", "label"], ["example.com.", "label"], ["exa_mple.com", "label"],
      [[..."aaa"].map(() => "a".repeat(63)).concat("a".repeat(62)).join("."), "253"],
      ["a".repeat(321), "320"], ["a".repeat(65) + "@example.com", "local part"], ["@example.com", "local part"],
      ["a@@example.com", "local part"], ["not a domain", "whitespace"], [" ", "whitespace"],
      ["bad\n.example.com", "control"], ["<bad>", "<"], ['a"@example.com', "<"], ["a'@example.com", "<"],
    ];
    it.each(rejected)("rejects %j (%s) before any vendor call", async (entry, reason) => {
      const { client, get, update } = senderListsClient(scope, { allow_list: [], block_list: [] });
      const result = await run(client, "block", "add", [entry]);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(reason);
      expect(get).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("names the offending entry JSON-quoted and cut to 80 characters", async () => {
      const { client } = senderListsClient(scope, { allow_list: [], block_list: [] });
      const long = "!".repeat(81);
      const result = await run(client, "block", "add", ["ok.example.com", long]);
      expect(result.content[0].text).toContain(JSON.stringify("!".repeat(80)));
      expect(result.content[0].text).not.toContain("!".repeat(81));
      expect((await run(client, "block", "add", ["*.*"])).content[0].text).toContain('"*.*"');
    });

    it("explains that IPv6, host wildcards and large ranges are unsupported", async () => {
      const { client } = senderListsClient(scope, { allow_list: [], block_list: [] });
      const text = async (entry: string) => (await run(client, "block", "add", [entry])).content[0].text;
      expect(await text("2001:db8::1")).toContain("IPv6 entries are not supported");
      expect(await text("*.example.com")).toContain("host wildcards are not supported");
      expect(await text("*.example.com")).toContain("list the domain itself");
      expect(await text("10.0.0.0/8")).toContain("ranges larger than /24 are not allowed");
    });

    it.each([
      ["an empty array", []],
      ["a non-array", "a.example.com"],
      ["a non-string item", ["a.example.com", 1]],
      ["an empty string", [""]],
      ["101 distinct entries", Array.from({ length: 101 }, (_, i) => `d${i}.example.com`)],
    ])("rejects %s", async (_name, entries) => {
      const { client, get } = senderListsClient(scope, { allow_list: [], block_list: [] });
      expect((await run(client, "block", "add", entries)).isError).toBe(true);
      expect(get).not.toHaveBeenCalled();
    });

    it("accepts 100 entries and counts the limit after de-duplication", async () => {
      const hundred = Array.from({ length: 100 }, (_, i) => `d${i}.example.com`);
      const { client } = senderListsClient(scope, { allow_list: [], block_list: [] });
      expect((await run(client, "block", "add", [...hundred, hundred[0].toUpperCase()])).isError).toBeUndefined();
    });
  });
});


/** Every stubbed vendor method has zero calls. */
function expectNoVendorCalls(client: ProofpointEssentialsClient) {
  for (const resource of Object.values(client as unknown as Stub)) {
    for (const method of Object.values(resource)) expect(method).not.toHaveBeenCalled();
  }
}

describe("path-argument safety", () => {
  const dotted = [".", ".."];
  const unsafe = [...dotted, "a/b", "a\\b", "a?b", "a#b", "a b", " a", "a\tb", "a\u0000b", "a\u007fb"];
  const senderListCalls = ["org", "users"].flatMap((scope) =>
    ["block_list_add", "block_list_remove", "allow_list_add", "allow_list_remove"].map((name): [string, Record<string, unknown>, string[]] =>
      scope === "org"
        ? [`org_${name}`, { orgDomain: "acme.com", entries: ["a.acme.com"] }, ["orgDomain"]]
        : [`users_${name}`, { orgDomain: "acme.com", email: "a@acme.com", entries: ["a.acme.com"] }, ["orgDomain", "email"]]));
  const calls: Array<[string, Record<string, unknown>, string[]]> = [
    ...senderListCalls,
    ["org_get", { domain: "acme.com" }, ["domain"]],
    ["org_set_active", { domain: "acme.com", isActive: true }, ["domain"]],
    ["org_delete", { domain: "acme.com", [CONFIRM_ARG]: true }, ["domain"]],
    ["endpoint_discover", { domain: "acme.com" }, ["domain"]],
    ["domains_list", { orgDomain: "acme.com" }, ["orgDomain"]],
    ["domains_create", { orgDomain: "acme.com", domains: ["a.com"] }, ["orgDomain"]],
    ["domains_update", { orgDomain: "acme.com", domain: "a.acme.com", data: { x: 1 } }, ["orgDomain", "domain"]],
    ["domains_delete", { orgDomain: "acme.com", domain: "a.acme.com", [CONFIRM_ARG]: true }, ["orgDomain", "domain"]],
    ["users_list", { orgDomain: "acme.com" }, ["orgDomain"]],
    ["users_get", { orgDomain: "acme.com", email: "a@acme.com" }, ["orgDomain"]],
    ["users_create", { orgDomain: "acme.com", users: [{ primary_email: "a@acme.com" }] }, ["orgDomain"]],
    ["users_update", { orgDomain: "acme.com", email: "a@acme.com", data: { surname: "S" } }, ["orgDomain", "email"]],
    ["users_delete", { orgDomain: "acme.com", email: "a@acme.com", [CONFIRM_ARG]: true }, ["orgDomain", "email"]],
    ["features_get", { orgDomain: "acme.com" }, ["orgDomain"]],
    ["features_update", { orgDomain: "acme.com", features: { x: 1 } }, ["orgDomain"]],
    ["licensing_get", { orgDomain: "acme.com" }, ["orgDomain"]],
    ["licensing_update", { orgDomain: "acme.com", licensing: { x: 1 } }, ["orgDomain"]],
    ["package_update", { orgDomain: "acme.com", package: { x: 1 } }, ["orgDomain"]],
    ["reporting_get", { orgDomain: "acme.com" }, ["orgDomain"]],
  ];
  const cases = calls.flatMap(([tool, valid, keys]) =>
    keys.flatMap((key) => (key === "email" ? [...unsafe, "plain", "@acme.com", "a@"] : unsafe)
      .map((value) => [tool, key, value, valid] as const)));

  it.each(cases)("%s rejects %s=%j before any vendor call", async (tool, key, value, valid) => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, `proofpoint_essentials_${tool}`, { ...valid, [key]: value }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(key);
    expectNoVendorCalls(client);
  });

  it("users_get still accepts a plain email because it only goes in the query string", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "proofpoint_essentials_users_get", {
      orgDomain: "acme.com", email: "..",
    }));
    expect(result.isError).toBeUndefined();
  });

  it("accepts ordinary domains and emails", async () => {
    const client = stubClient();
    const result = asTool(await handleToolCall(client, "proofpoint_essentials_users_delete", {
      orgDomain: "sub.acme.co.uk", email: "first.last+tag@acme.com", [CONFIRM_ARG]: true,
    }));
    expect(result.isError).toBeUndefined();
    expect(client.users.delete).toHaveBeenCalledWith("sub.acme.co.uk", "first.last+tag@acme.com");
  });
});


describe("users_update always read-merges the existing record", () => {
  const args = { orgDomain: "example.com", email: "user@example.com", data: { surname: "Updated" } };
  const existing = {
    type: "organization_admin", role: "admin", primary_email: "user@example.com",
    firstname: "Example", surname: "Original", is_active: false,
    uid: 1, password: "secret", creation_date: "2025-01-01",
    last_update: "2025-02-01", last_login: "2025-03-01",
  };
  const merged = {
    type: "organization_admin", role: "admin", primary_email: "user@example.com",
    firstname: "Example", surname: "Updated", is_active: false,
  };
  function clientWith(response: unknown) {
    return stubClient({ users: { get: vi.fn().mockResolvedValue(response) } });
  }
  async function update(client: ProofpointEssentialsClient, overrides: Record<string, unknown> = {}) {
    return asTool(await handleToolCall(client, "proofpoint_essentials_users_update", { ...args, ...overrides }));
  }

  it("merges all existing fields with changes without read-only fields", async () => {
    const client = clientWith(existing);
    expect((await update(client)).isError).toBeUndefined();
    expect(client.users.get).toHaveBeenCalledWith("example.com", "user@example.com");
    expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", merged);
    expect(existing).toMatchObject({ uid: 1, password: "secret", surname: "Original" });
  });

  it("reads the existing user even when type is supplied, and the supplied type wins", async () => {
    const client = clientWith(existing);
    await update(client, { data: { type: "end_user" } });
    expect(client.users.get).toHaveBeenCalledWith("example.com", "user@example.com");
    expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", {
      ...merged, surname: "Original", type: "end_user",
    });
  });

  it("applies a supplied role and keeps the existing type", async () => {
    const client = clientWith({ ...existing, role: "user" });
    await update(client, { data: { surname: "Updated", role: "admin" } });
    expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", merged);
  });

  it("echoes sender-list fields because the PUT may replace the whole record", async () => {
    const lists = { allow_list: ["a@example.com"], block_list: ["spam.example.com"] };
    const client = clientWith({ ...existing, ...lists });
    await update(client);
    expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", { ...merged, ...lists });
  });

  describe("response shapes", () => {
    const other = { primary_email: "other@example.com", type: "end_user", surname: "Other" };
    it("accepts a flat user object", async () => {
      const client = clientWith(existing);
      await update(client);
      expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", merged);
    });
    it("picks the matching user from a {users: [...]} object, ignoring case", async () => {
      const client = clientWith({ users: [other, { ...existing, primary_email: "User@Example.com" }] });
      await update(client);
      expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", {
        ...merged, primary_email: "User@Example.com",
      });
    });
    it("picks the matching user from a bare array", async () => {
      const client = clientWith([other, existing]);
      await update(client);
      expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", merged);
    });
    it.each([
      ["a mismatched primary_email", { ...existing, primary_email: "other@example.com" }],
      ["a flat object without primary_email", { type: "organization_admin", role: "admin" }],
      ["a users list without the user", { users: [other] }],
      ["an empty array", []],
      ["null", null],
      ["a string", "nope"],
    ])("refuses on %s and makes no PUT", async (_name, response) => {
      const client = clientWith(response);
      const result = await update(client);
      expect(result.isError).toBe(true);
      expect(client.users.update).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["empty", {}],
    ["only null and undefined values", { surname: null, firstname: undefined }],
  ])("rejects data that is %s before any vendor call", async (_name, data) => {
    const client = clientWith(existing);
    const result = await update(client, { data });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("data");
    expectNoVendorCalls(client);
  });

  for (const field of ["type", "role"]) {
    it.each([123, true, ["a"], { a: 1 }])(`rejects a non-string ${field} (%j) before any vendor call`, async (value) => {
      const client = clientWith(existing);
      const result = await update(client, { data: { surname: "Updated", [field]: value } });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(field);
      expectNoVendorCalls(client);
    });
    it.each([null, undefined, "", "   "])(`treats ${field} %j as omitted and keeps the existing value`, async (value) => {
      const client = clientWith(existing);
      await update(client, { data: { surname: "Updated", [field]: value } });
      expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", merged);
    });
  }

  it.each([null, undefined])("keeps existing fields when an update value is %j", async (firstname) => {
    const client = clientWith(existing);
    await update(client, { data: { surname: "Updated", firstname, department: "" } });
    expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", { ...merged, department: "" });
  });

  it.each([undefined, null, "", "   ", 123])("fails closed when the existing type is %j and none is supplied", async (type) => {
    const client = clientWith({ ...existing, type });
    const result = await update(client);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("End User");
    expect(client.users.update).not.toHaveBeenCalled();
  });

  it("proceeds without an existing type when a type is supplied", async () => {
    const client = clientWith({ ...existing, type: undefined });
    await update(client, { data: { type: "end_user" } });
    expect(client.users.update).toHaveBeenCalledWith("example.com", "user@example.com", {
      role: "admin", primary_email: "user@example.com", firstname: "Example", surname: "Original",
      is_active: false, type: "end_user",
    });
  });
});
