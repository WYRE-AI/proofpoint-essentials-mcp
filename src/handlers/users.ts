/** User tool handlers. */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { BatchItemResult, ProofpointEssentialsClient, ProofpointUserInput } from "@wyre-ai/node-proofpoint-essentials";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import {
  batchCreateResult,
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
  for (const [index, user] of users.entries()) {
    if (typeof user.primary_email !== "string" || user.primary_email.trim() === "") {
      const hints = [
        "email" in user ? 'Use "primary_email" instead of "email".' : "",
        "lastname" in user ? 'Use "surname" instead of "lastname".' : "",
      ].filter(Boolean).join(" ");
      return errorResult(
        `users[${index}].primary_email is required and must be a non-empty string.${hints ? ` ${hints}` : ""}`
      );
    }
  }
  const inputs: ProofpointUserInput[] = users.map((user) => {
    const input = { ...user } as ProofpointUserInput;
    for (const field of ["uid", "creation_date", "last_update", "last_login", "password"]) {
      delete input[field];
    }
    return input;
  });
  const results: BatchItemResult[] = await client.users.create(orgDomain, inputs);
  return batchCreateResult("user", results, inputs.length);
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
