/** Domain tool handlers. */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import {
  errorResult,
  jsonResult,
  requireObject,
  requireString,
  requireStringArray,
  textResult,
  type ToolResult,
} from "./results.js";

export async function listDomains(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const domains = await client.domains.list(orgDomain);
  return jsonResult({ count: domains.length, domains });
}

export async function createDomains(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const domains = requireStringArray(args, "domains");
  const result = await client.domains.create(orgDomain, domains);
  return jsonResult(result);
}

export async function updateDomain(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const domain = requireString(args, "domain");
  const data = requireObject(args, "data");
  const result = await client.domains.update(orgDomain, domain, data);
  return jsonResult(result);
}

export async function deleteDomain(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const orgDomain = requireString(args, "orgDomain");
  const domain = requireString(args, "domain");

  const gate = confirmDestructive(
    elicitation,
    args,
    `Permanently remove domain ${domain} from organization ${orgDomain}? Mail flow for ` +
      `this domain will no longer be protected. This cannot be undone.`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") {
    return textResult(`Deletion cancelled by user — domain ${domain} was NOT removed.`);
  }

  await client.domains.delete(orgDomain, domain);
  return jsonResult({ deleted: true, orgDomain, domain });
}
