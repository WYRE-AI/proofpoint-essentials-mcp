/** User tool handlers. */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import {
  errorResult,
  jsonResult,
  requireObject,
  requireObjectArray,
  requireString,
  textResult,
  type ToolResult,
} from "./results.js";

export async function listUsers(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const users = await client.users.list(orgDomain);
  return jsonResult({ count: users.length, users });
}

export async function getUser(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const email = requireString(args, "email");
  const user = await client.users.get(orgDomain, email);
  return jsonResult(user);
}

export async function createUsers(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const users = requireObjectArray(args, "users");
  const result = await client.users.create(orgDomain, users);
  return jsonResult(result);
}

export async function updateUser(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requireString(args, "orgDomain");
  const email = requireString(args, "email");
  const data = requireObject(args, "data");
  const result = await client.users.update(orgDomain, email, data);
  return jsonResult(result);
}

export async function deleteUser(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const orgDomain = requireString(args, "orgDomain");
  const email = requireString(args, "email");

  const gate = confirmDestructive(
    elicitation,
    args,
    `Permanently remove user ${email} from organization ${orgDomain}? This cannot be undone.`
  );
  if (gate.kind === "ask") return gate.result;
  if (gate.kind === "blocked") return errorResult(gate.message);
  if (gate.kind === "refused") {
    return textResult(`Deletion cancelled by user — user ${email} was NOT removed.`);
  }

  await client.users.delete(orgDomain, email);
  return jsonResult({ deleted: true, orgDomain, email });
}
