import { describe, expect, it } from "vitest";
import {
  GATEWAY_HEADERS,
  buildCredentials,
  listToolsResult,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "../mcp-server.js";
import { TOOLS } from "../tools.js";

describe("buildCredentials", () => {
  it("succeeds with username + password, region optional", () => {
    const { creds, error } = buildCredentials("user", "pass", undefined);
    expect(error).toBeUndefined();
    expect(creds).toEqual({ username: "user", password: "pass", region: undefined });
  });

  it("carries region through when provided", () => {
    const { creds } = buildCredentials("user", "pass", "eu1");
    expect(creds?.region).toBe("eu1");
  });

  it("fails when username is missing, naming the header", () => {
    const { error, creds } = buildCredentials(undefined, "pass", undefined);
    expect(creds).toBeUndefined();
    expect(error).toContain("X-Proofpoint-Essentials-Username");
  });

  it("fails when password is missing, naming the header", () => {
    const { error } = buildCredentials("user", undefined, undefined);
    expect(error).toContain("X-Proofpoint-Essentials-Password");
  });

  it("names both headers when both are missing", () => {
    const { error } = buildCredentials(undefined, undefined, undefined);
    expect(error).toContain("X-Proofpoint-Essentials-Username");
    expect(error).toContain("X-Proofpoint-Essentials-Password");
  });
});

describe("resolveGatewayCredentials", () => {
  it("reads lowercased gateway headers", () => {
    const headers: Record<string, string> = {
      "x-proofpoint-essentials-username": "gw-user",
      "x-proofpoint-essentials-password": "gw-pass",
      "x-proofpoint-essentials-region": "eu1",
    };
    const { creds } = resolveGatewayCredentials((name) => headers[name]);
    expect(creds).toEqual({ username: "gw-user", password: "gw-pass", region: "eu1" });
  });

  it("401-shape error when headers are absent", () => {
    const { error, creds } = resolveGatewayCredentials(() => undefined);
    expect(creds).toBeUndefined();
    expect(error).toBeDefined();
  });

  it("GATEWAY_HEADERS names exactly the three headers this resolver reads", () => {
    expect(GATEWAY_HEADERS).toEqual([
      "X-Proofpoint-Essentials-Username",
      "X-Proofpoint-Essentials-Password",
      "X-Proofpoint-Essentials-Region",
    ]);
  });
});

describe("resolveEnvCredentials", () => {
  it("reads PROOFPOINT_ESSENTIALS_* env vars", () => {
    const { creds } = resolveEnvCredentials({
      PROOFPOINT_ESSENTIALS_USERNAME: "env-user",
      PROOFPOINT_ESSENTIALS_PASSWORD: "env-pass",
      PROOFPOINT_ESSENTIALS_REGION: "us1",
    });
    expect(creds).toEqual({ username: "env-user", password: "env-pass", region: "us1" });
  });

  it("errors when the env vars are unset", () => {
    const { error } = resolveEnvCredentials({});
    expect(error).toBeDefined();
  });
});

describe("listToolsResult", () => {
  it("returns the module-scope TOOLS array by reference, every call", () => {
    const a = listToolsResult();
    const b = listToolsResult();
    expect(a.tools).toBe(TOOLS);
    expect(b.tools).toBe(TOOLS);
    expect(a.tools).toBe(b.tools);
  });
});
