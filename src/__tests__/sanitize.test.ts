import { describe, expect, it, vi } from "vitest";
import { ConflictError, ServiceError, ValidationError, type BatchItemResult, type ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { sanitize } from "../utils/sanitize.js";
import { batchCreateResult, type ToolResult } from "../handlers/results.js";
import { handleToolCall } from "../handlers/index.js";

describe("sanitize", () => {
  it.each([
    "bob%40example.com", "bob%2540example.com", "bob&#64;example.com",
    "bob&#x40;example.com", "bob&commat;example.com", String.raw`bob\u0040example.com`,
    "bob＠example.com", "bob @ ex.com", '"john doe"@example.com', '"a@b"@example.com',
    "bob+tag@sub.example.com", "mailto:a@b", "<a@b>", "a@[127.0.0.1]",
    "[a@b]", "x=a@b&y=1",
  ])("redacts %s", (email) => {
    const result = sanitize(email);
    expect(result).toContain("[redacted-email]");
    expect(result).not.toMatch(/example|ex\.com|127\.0|@/);
  });
  it("optionally redacts bare hostnames", () => {
    expect(sanitize("example.com sub.example.co.uk", { redactHostnames: true }))
      .toBe("[redacted-domain] [redacted-domain]");
    expect(sanitize("example.com")).toBe("example.com");
  });
  it("caps after redaction at Unicode code point boundaries", () => {
    const result = sanitize("a".repeat(299) + "😀tail");
    expect(result).toBe("a".repeat(299) + "😀");
    expect(Array.from(result)).toHaveLength(300);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(sanitize("bob@example.com ".repeat(40))).not.toContain("example.com");
  });
});

describe("sanitize input bounds", () => {
  it.each([
    ["a long run with no @", "a".repeat(200_000)],
    ["an unterminated quote run", '"'.repeat(50_000)],
    ["a long hostname-like run", "a.".repeat(100_000)],
  ])("stays fast on %s", (_label, input) => {
    const started = performance.now();
    const result = sanitize(input, { redactHostnames: true });
    expect(performance.now() - started).toBeLessThan(500);
    expect(Array.from(result).length).toBeLessThanOrEqual(300);
  });
});

describe("error boundaries", () => {
  const body = { code: 42, message: "bob@x.com exists", private: "RAW_BODY_SECRET" };
  it.each([
    new ServiceError(body.message, 400, body),
    new ConflictError(body.message, body),
    new ValidationError(body.message, [{ field: "email", message: body.message }], body),
  ])("reduces create rejection $statusCode to safe text and metadata", async (error) => {
    const client = { users: { create: vi.fn().mockRejectedValue(error) } } as unknown as ProofpointEssentialsClient;
    const result = await handleToolCall(client, "proofpoint_essentials_users_create", {
      orgDomain: "example.com", users: [{ primary_email: "bob@x.com" }],
    }) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(`[redacted-email] exists`);
    expect(result.content[0].text).toContain(`"statusCode":${error.statusCode},"code":42`);
    expect(result.content[0].text).not.toMatch(/bob|RAW_BODY_SECRET|private/);
    expect(Array.from(result.content[0].text).length).toBeLessThanOrEqual(300);
  });
  it.each([new Error("sub.example.co.uk bob@x.com"), new ConflictError("sub.example.co.uk bob@x.com", body)])(
    "redacts domain-tool errors", async (error) => {
      const client = { domains: { create: vi.fn().mockRejectedValue(error) } } as unknown as ProofpointEssentialsClient;
      const result = await handleToolCall(client, "proofpoint_essentials_domains_create", {
        orgDomain: "example.com", domains: ["sub.example.co.uk"],
      }) as ToolResult;
      expect(result.content[0].text).toContain("[redacted-domain]");
      expect(result.content[0].text).not.toMatch(/example|bob@/);
    }
  );
  it("surfaces status and sanitized message from a documented errors array", () => {
    const result = batchCreateResult("user", [
      { errors: [{ status: 409, error_message: "bob@x.com already exists" }] },
    ] as unknown as BatchItemResult[], 1);
    const text = result.content[0].text;
    const payload = JSON.parse(text.slice(text.indexOf("\n\n") + 2));
    expect(result.isError).toBe(true);
    expect(payload.results[0]).toEqual({
      index: 0, outcome: "failed", status: 409, message: "[redacted-email] already exists",
    });
  });
  it("prefers a sanitized errors array message over a top-level message", () => {
    const result = batchCreateResult("user", [
      { message: "Request failed", errors: [{ status: 409, error_message: "bob@x.com already exists" }] },
    ] as unknown as BatchItemResult[], 1);
    const text = result.content[0].text;
    const payload = JSON.parse(text.slice(text.indexOf("\n\n") + 2));
    expect(result.isError).toBe(true);
    expect(payload.results[0]).toEqual({
      index: 0, outcome: "failed", status: 409, message: "[redacted-email] already exists",
    });
  });
  it.each([
    { success: true, status: 201, error: null },
    { success: true, status: 201, errors: [] },
  ])("keeps raw results for a confirmed success with an empty error field %j", (item) => {
    const result = batchCreateResult("user", [item] as BatchItemResult[], 1);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).results).toEqual([item]);
  });
  it.each([
    { error: "bob@x.com exists" },
    { success: true, error: "bob@x.com exists" },
    { success: true, errors: ["bob@x.com exists"] },
    "bob@x.com exists",
    { message: "bob@x.com exists" },
  ])("cleans uncertain or erroneous batch item %j", (item) => {
    const result = batchCreateResult("user", [item] as BatchItemResult[], 1);
    const text = result.content[0].text;
    const payload = JSON.parse(text.includes("\n\n") ? text.split("\n\n")[1] : text);
    expect(payload.summary.succeeded).toBe(0);
    expect(payload.results[0].index).toBe(0);
    expect(text).not.toContain("bob@x.com");
    if (typeof item === "string") {
      expect(payload.summary.unconfirmed).toBe(1);
      expect(payload.results[0].message).toBe("[redacted-email] exists");
    }
  });
});
