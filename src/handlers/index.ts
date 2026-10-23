/**
 * tools/call dispatch. The SDK client is bound per request by the caller
 * (mcp-server.ts); this module maps tool names to handlers and normalizes
 * every failure into an isError text result — errors are never thrown out.
 */
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import { ServiceError, type ProofpointEssentialsClient } from "@wyre-ai/node-proofpoint-essentials";
import { sanitize } from "../utils/sanitize.js";
import { NO_ELICITATION, type ElicitationContext } from "../elicitation.js";
import { deleteDomain, createDomains, listDomains, updateDomain } from "./domains.js";
import {
  createToken,
  discoverEndpoint,
  getFeatures,
  getLicensing,
  getReporting,
  updateFeatures,
  updateLicensing,
  updatePackage,
} from "./misc.js";
import { deleteOrg, getOrg, setOrgActive } from "./orgs.js";
import { createUsers, deleteUser, getUser, listUsers, updateUser } from "./users.js";
import { errorResult, ToolInputError, type ToolResult } from "./results.js";

type ToolHandler = (
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  elicitation: ElicitationContext
) => Promise<ToolResult | InputRequiredResult>;

const HANDLERS: Record<string, ToolHandler> = {
  proofpoint_essentials_org_get: (client, args) => getOrg(client, args),
  proofpoint_essentials_org_set_active: (client, args) => setOrgActive(client, args),
  proofpoint_essentials_org_delete: deleteOrg,
  proofpoint_essentials_domains_list: (client, args) => listDomains(client, args),
  proofpoint_essentials_domains_create: (client, args) => createDomains(client, args),
  proofpoint_essentials_domains_update: (client, args) => updateDomain(client, args),
  proofpoint_essentials_domains_delete: deleteDomain,
  proofpoint_essentials_users_list: (client, args) => listUsers(client, args),
  proofpoint_essentials_users_get: (client, args) => getUser(client, args),
  proofpoint_essentials_users_create: (client, args) => createUsers(client, args),
  proofpoint_essentials_users_update: (client, args) => updateUser(client, args),
  proofpoint_essentials_users_delete: deleteUser,
  proofpoint_essentials_endpoint_discover: (client, args) => discoverEndpoint(client, args),
  proofpoint_essentials_features_get: (client, args) => getFeatures(client, args),
  proofpoint_essentials_features_update: (client, args) => updateFeatures(client, args),
  proofpoint_essentials_licensing_get: (client, args) => getLicensing(client, args),
  proofpoint_essentials_licensing_update: (client, args) => updateLicensing(client, args),
  proofpoint_essentials_package_update: (client, args) => updatePackage(client, args),
  proofpoint_essentials_reporting_get: (client, args) => getReporting(client, args),
  proofpoint_essentials_token_create: (client, args) => createToken(client, args),
};

function describeServiceError(error: ServiceError, redactHostnames: boolean): string {
  const response = error.response;
  const code = response !== null && typeof response === "object" && "code" in response
    ? response.code : undefined;
  const metadata = {
    statusCode: error.statusCode,
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
  };
  return sanitize(
    `Proofpoint Essentials error (HTTP ${error.statusCode}): ${sanitize(error.message, { redactHostnames })}. Response: ${JSON.stringify(metadata)}`,
    { redactHostnames }
  );
}

export async function handleToolCall(
  client: ProofpointEssentialsClient,
  name: string,
  args: Record<string, unknown>,
  elicitation: ElicitationContext = NO_ELICITATION
): Promise<ToolResult | InputRequiredResult> {
  const redactHostnames = name.startsWith("proofpoint_essentials_domains_");
  const handler = HANDLERS[name];
  if (!handler) {
    return errorResult(sanitize(`Unknown tool: ${name}`, { redactHostnames }));
  }
  try {
    const result = await handler(client, args, elicitation);
    // Batch helpers sanitize each message; preserve their structured JSON and counts.
    const isBatchCreate = name === "proofpoint_essentials_users_create" ||
      name === "proofpoint_essentials_domains_create";
    if ("isError" in result && result.isError === true && !isBatchCreate) {
      return { ...result, content: (result as ToolResult).content.map((part) => part.type === "text"
        ? { ...part, text: sanitize(part.text, { redactHostnames }) } : part) };
    }
    return result;
  } catch (error) {
    if (error instanceof ToolInputError) {
      return errorResult(sanitize(`Invalid arguments for ${name}: ${error.message}`, { redactHostnames }));
    }
    if (error instanceof ServiceError) {
      return errorResult(describeServiceError(error, redactHostnames));
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(sanitize(`Error calling ${name}: ${message}`, { redactHostnames }));
  }
}
