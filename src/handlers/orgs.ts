/** Organization tool handlers. */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import { errorResult, jsonResult, requireBoolean, requireString, textResult, type ToolResult } from "./results.js";

export async function getOrg(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const domain = requireString(args, "domain");
  const org = await client.orgs.get(domain);
  return jsonResult(org);
}

export async function setOrgActive(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const domain = requireString(args, "domain");
  const isActive = requireBoolean(args, "isActive");
  const org = await client.orgs.setActive(domain, isActive);
  return jsonResult(org);
}

export async function deleteOrg(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const domain = requireString(args, "domain");

  const gate = confirmDestructive(
    elicitation,
    args,
    `Permanently delete organization ${domain} and all of its domains, users, and ` +
      `configuration? This cannot be undone.`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") {
    return textResult(`Deletion cancelled by user — organization ${domain} was NOT deleted.`);
  }

  await client.orgs.delete(domain);
  return jsonResult({ deleted: true, domain });
}
