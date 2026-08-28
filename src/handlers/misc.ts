/** Endpoint-discovery, features, licensing, package, reporting, and token handlers. */
import type { ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { jsonResult, optionalObject, optionalString, requireObject, requireString, type ToolResult } from "./results.js";

export async function discoverEndpoint(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const domain = requireString(args, "domain");
  const result = await client.endpoints.discover(domain);
  return jsonResult(result);
}

export async function getFeatures(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const features = await client.features.get(orgDomain);
  return jsonResult(features);
}

export async function updateFeatures(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const features = requireObject(args, "features");
  const result = await client.features.update(orgDomain, features);
  return jsonResult(result);
}

export async function getLicensing(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const licensing = await client.licensing.get(orgDomain);
  return jsonResult(licensing);
}

export async function updateLicensing(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const licensing = requireObject(args, "licensing");
  const result = await client.licensing.update(orgDomain, licensing);
  return jsonResult(result);
}

export async function updatePackage(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const pkg = requireObject(args, "package");
  const result = await client.package.update(orgDomain, pkg);
  return jsonResult(result);
}

export async function getReporting(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const start = optionalString(args, "start");
  const end = optionalString(args, "end");
  const extra = optionalObject(args, "params");
  const result = await client.reporting.get(orgDomain, { ...extra, start, end });
  return jsonResult(result);
}

export async function createToken(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const body = optionalObject(args, "body");
  const result = await client.token.create(body);
  return jsonResult(result);
}
