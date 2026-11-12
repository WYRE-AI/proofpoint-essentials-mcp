/** User tool handlers. */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { BatchItemResult, ProofpointEssentialsClient, ProofpointUserInput } from "@wyre-ai/node-proofpoint-essentials";
import { confirmDestructive, type ElicitationContext } from "../elicitation.js";
import {
  batchCreateResult,
  errorResult,
  jsonResult,
  requireEmailSegment,
  requireObject,
  requireObjectArray,
  requirePathSegment,
  requireString,
  textResult,
  ToolInputError,
  type ToolResult,
} from "./results.js";

/** Fields Proofpoint returns but does not accept back on a write. */
const RESPONSE_ONLY_FIELDS = ["uid", "creation_date", "last_update", "last_login", "password"];

export async function listUsers(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
  const users = await client.users.list(orgDomain);
  return jsonResult({ count: users.length, users });
}

export async function getUser(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
  // The SDK sends the email as a query parameter here, so it is not a path segment.
  const email = requireString(args, "email");
  const user = await client.users.get(orgDomain, email);
  return jsonResult(user);
}

export async function createUsers(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
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
    for (const field of RESPONSE_ONLY_FIELDS) delete input[field];
    return input;
  });
  const results: BatchItemResult[] = await client.users.create(orgDomain, inputs);
  return batchCreateResult("user", results, inputs.length);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * users.get filters the list endpoint by email, so the response may be a bare
 * array, a {users: [...]} object, or a single user. Return the user whose
 * primary_email matches, or undefined when none does.
 */
function findUser(response: unknown, email: string): Record<string, unknown> | undefined {
  const candidates = Array.isArray(response) ? response
    : isRecord(response) && Array.isArray(response.users) ? response.users
    : [response];
  return candidates.find((candidate): candidate is Record<string, unknown> =>
    isRecord(candidate) && typeof candidate.primary_email === "string" &&
    candidate.primary_email.toLowerCase() === email.toLowerCase());
}

/**
 * Update a user. PUT may replace the whole record, so always read the existing
 * user first and send it back in full with the supplied fields on top.
 */
export async function updateUser(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
  const email = requireEmailSegment(args, "email");
  const data = Object.fromEntries(
    Object.entries(requireObject(args, "data")).filter(([, value]) => value !== null && value !== undefined)
  );
  if (Object.keys(data).length === 0) {
    throw new ToolInputError('Argument "data" must contain at least one field with a value.');
  }
  for (const field of ["type", "role"]) {
    if (!(field in data)) continue;
    if (typeof data[field] !== "string") throw new ToolInputError(`"data.${field}" must be a string.`);
    if (data[field].trim() === "") delete data[field]; // blank means omitted
  }

  const existing = findUser(await client.users.get(orgDomain, email), email);
  if (existing === undefined) {
    return errorResult("Update refused: the existing user record could not be read reliably; nothing was changed.");
  }
  if (data.type === undefined && (typeof existing.type !== "string" || existing.type.trim() === "")) {
    return errorResult("Update refused: existing account type/role could not be read reliably; refusing to risk resetting the account to End User.");
  }
  const writable = Object.entries(existing).filter(([key]) => !RESPONSE_ONLY_FIELDS.includes(key));
  const body = { ...Object.fromEntries(writable), ...data };
  const result = await client.users.update(orgDomain, email, body);
  return jsonResult(result);
}

export async function deleteUser(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
): Promise<ToolResult | InputRequiredResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
  const email = requireEmailSegment(args, "email");

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
