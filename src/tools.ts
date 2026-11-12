/**
 * The complete Proofpoint Essentials tool surface — 28 tools, FLAT (no router).
 *
 * Deterministic ordering rule: all tools live in this single module-scope
 * `TOOLS` array, grouped by resource (orgs, domains, users, endpoints,
 * features, licensing, package, reporting, token), reads before writes
 * within each group. `tools/list` returns this array by reference for every
 * request, every era, every caller. Never sorted at runtime, never filtered
 * per-session, never varied by credentials.
 *
 * The eight sender-list tools (`org_*_list_*` and `users_*_list_*`) sit directly
 * after `org_delete` and `users_delete`, each group in the order block add,
 * block remove, allow add, allow remove. They have no `list` argument because
 * the gateway grants access per tool name, not per argument.
 *
 * Every org/domain/user-scoped tool takes the target org's domain as a
 * per-call argument — Proofpoint Essentials is an MSP multi-tenant API, and
 * one set of gateway credentials manages many customer orgs, so the target
 * org is never baked into credentials.
 *
 * Hand-written JSON Schema (no zod). Destructive tools follow fleet
 * convention: description prefix + MCP annotations, and every destructive
 * description ends with "Confirm with the user before invoking."
 *
 * Two destructive tiers:
 *   - Tier A (irreversible deletes): "⚠ DESTRUCTIVE — IRREVERSIBLE." prefix,
 *     `idempotentHint: false`, gated at runtime via `confirmDestructive()`
 *     (see elicitation.ts) — the CONFIRM_ARG_PROPERTY fields below.
 *   - Tier B (high-impact but reversible: status toggles, config/licensing
 *     updates, and the six sender-list tools other than block-list add):
 *     "⚠ HIGH-IMPACT." prefix, `idempotentHint: true`, warning label only —
 *     no runtime confirmation gate.
 *
 * Outside the tiers, `org_block_list_add` and `users_block_list_add` are
 * routine, idempotent, non-destructive writes meant for unattended automation:
 * no warning prefix and no confirm sentence.
 */
import type { Tool } from "@modelcontextprotocol/server";
import { CONFIRM_ARG_PROPERTY } from "./elicitation.js";

const READ_ANNOTATIONS = { readOnlyHint: true } as const;
const WRITE_ANNOTATIONS = { readOnlyHint: false } as const;
const HIGH_IMPACT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;
const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const domainProp = {
  type: "string" as const,
  description:
    "The customer organization's primary domain identifier within the MSP's " +
    "Proofpoint Essentials account (e.g. 'customer.com').",
};

const orgDomainProp = { ...domainProp, description: "The target organization's primary domain." };

/**
 * Block-list add is a routine write for unattended automation: it only adds
 * entries to the block list, never touches the allow list or the user record,
 * and is idempotent.
 */
const ROUTINE_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Why each Tier B sender-list change is high-impact; block/add is the routine one and has none. */
const SENDER_LIST_RISK: Record<string, string | undefined> = {
  "block/remove": "Removing a block entry re-admits a blocked sender.",
  "allow/add": "Allow-listing lets mail from that sender bypass spam filtering.",
  "allow/remove": "Removing an allow entry sends that sender's mail back through filtering.",
};

/**
 * Block/allow and add/remove are separate tools with no `list` argument because
 * the gateway grants access per tool name, not per argument.
 */
function senderListTool(scope: "org" | "users", list: "block" | "allow", action: "add" | "remove"): Tool {
  const opposite = list === "block" ? "allow" : "block";
  const record = scope === "org" ? "organization" : "user";
  const risk = SENDER_LIST_RISK[`${list}/${action}`];
  const description =
    `${action === "add" ? "Add entries to" : "Remove entries from"} the ${record}'s ${list} list only. ` +
    `Touches only the sender-lists resource, never the ${record} record, and never changes the ${opposite} list. ` +
    (action === "add"
      ? `Entries that are also on the ${opposite} list are reported in also_on_${opposite}_list. `
      : "") +
    (risk ? `${risk} ` : "") +
    "Reads the current lists, changes only the matching entries (case-insensitive), writes both lists, " +
    "then re-reads to verify; not atomic, so concurrent edits can overwrite each other. " +
    "Entries: emails, domains, IPv4 addresses, IPv4 wildcards (a.b.c.* or a.b.*.*), or CIDRs from /24 to /32; " +
    "at most 100 per call; no IPv6 and no host wildcards.";
  return {
    name: `proofpoint_essentials_${scope}_${list}_list_${action}`,
    description: risk ? `⚠ HIGH-IMPACT. ${description} Confirm with the user before invoking.` : description,
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        ...(scope === "users" ? { email: { type: "string", description: "The user's primary email address." } } : {}),
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1, maxLength: 320 },
          description: "Sender entries, e.g. user@example.com, example.com, *@example.com, 10.91.*.*, 192.168.1.0/24.",
        },
      },
      required: ["orgDomain", ...(scope === "users" ? ["email"] : []), "entries"],
    },
    annotations: risk ? HIGH_IMPACT_ANNOTATIONS : ROUTINE_WRITE_ANNOTATIONS,
  };
}

/** The four tools of one scope, in the fixed order block add/remove, allow add/remove. */
const senderListTools = (scope: "org" | "users"): Tool[] => [
  senderListTool(scope, "block", "add"),
  senderListTool(scope, "block", "remove"),
  senderListTool(scope, "allow", "add"),
  senderListTool(scope, "allow", "remove"),
];

export const TOOLS: Tool[] = [
  // ── Organizations ──────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_org_get",
    description: "Get an organization's data and its associated domains.",
    inputSchema: {
      type: "object",
      properties: { domain: domainProp },
      required: ["domain"],
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_org_set_active",
    description:
      "⚠ HIGH-IMPACT. Activate or deactivate an organization. Deactivating stops all " +
      "email protection for the org. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        domain: domainProp,
        isActive: { type: "boolean", description: "true to activate, false to deactivate." },
      },
      required: ["domain", "isActive"],
    },
    annotations: HIGH_IMPACT_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_org_delete",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently delete an organization and all of its " +
      "domains, users, and configuration. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: { domain: domainProp, ...CONFIRM_ARG_PROPERTY },
      required: ["domain"],
    },
    annotations: DESTRUCTIVE_ANNOTATIONS,
  },

  ...senderListTools("org"),

  // ── Domains ─────────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_domains_list",
    description: "List the domains within an organization.",
    inputSchema: {
      type: "object",
      properties: { orgDomain: orgDomainProp },
      required: ["orgDomain"],
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_domains_create",
    description:
      "Add one or more domains to an organization. Each name is sent as a Domain object {name}. " +
      "Returns summary (requested, returned, succeeded, failed, unconfirmed); missing items are unconfirmed. " +
      "Any failure sets isError; failures or unconfirmed items reduce results to index, outcome, numeric status/code, and message. " +
      "Error text and cleaned messages redact emails (including encoded @, spaced @, and quoted local parts), capped at 300 Unicode code points each; domain errors and messages also redact bare hostnames. Vendor error bodies retain only statusCode and scalar code metadata. Raw results are returned only when all items succeeded and none are unconfirmed. Succeeded items are created and must not be retried.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        domains: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Domain names to add.",
        },
      },
      required: ["orgDomain", "domains"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_domains_update",
    description: "⚠ HIGH-IMPACT. Update a domain's configuration. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        domain: { type: "string", description: "The domain name to update." },
        data: {
          type: "object",
          additionalProperties: true,
          description: "Fields to update on the domain.",
        },
      },
      required: ["orgDomain", "domain", "data"],
    },
    annotations: HIGH_IMPACT_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_domains_delete",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently remove a domain from an organization. " +
      "Mail flow for this domain will no longer be protected. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        domain: { type: "string", description: "The domain name to remove." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["orgDomain", "domain"],
    },
    annotations: DESTRUCTIVE_ANNOTATIONS,
  },

  // ── Users ───────────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_users_list",
    description: "List all mailbox-protected users in an organization.",
    inputSchema: {
      type: "object",
      properties: { orgDomain: orgDomainProp },
      required: ["orgDomain"],
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_users_get",
    description: "Get a single user by email address.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        email: { type: "string", description: "The user's email address." },
      },
      required: ["orgDomain", "email"],
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_users_create",
    description:
      "Add one or more users to an organization. Users are sent to Proofpoint as a bare array of " +
      "User objects (primary_email required). Response-only fields " +
      "(uid, password, creation_date, last_update, last_login) are ignored on create. " +
      "Returns summary (requested, returned, succeeded, failed, unconfirmed); missing items are unconfirmed. " +
      "Any failure sets isError; failures or unconfirmed items reduce results to index, outcome, numeric status/code, and message. " +
      "Error text and cleaned messages redact emails (including encoded @, spaced @, and quoted local parts), capped at 300 Unicode code points each. Vendor error bodies retain only statusCode and scalar code metadata. Raw results are returned only when all items succeeded and none are unconfirmed. Succeeded items are created and must not be retried.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        users: {
          type: "array",
          items: {
            type: "object",
            properties: {
              primary_email: {
                type: "string",
                description: "Primary email address (required). Proofpoint field name; not `email`.",
              },
              firstname: { type: "string" },
              surname: {
                type: "string",
                description: "Last name (Proofpoint field name; not `lastname`).",
              },
              type: {
                type: "string",
                enum: [
                  "end_user", "silent_user", "functional_account", "organization_admin",
                  "channel_admin", "strategic_partner_admin", "oem_partner_admin",
                ],
                description: "Proofpoint user type (account role).",
              },
              is_active: { type: "boolean" },
              send_welcome_email: { type: "boolean" },
              alias_emails: { type: "array", items: { type: "string" } },
            },
            required: ["primary_email"],
            additionalProperties: true,
          },
          minItems: 1,
          description: "User objects to create.",
        },
      },
      required: ["orgDomain", "users"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_users_update",
    description:
      "⚠ HIGH-IMPACT. Update a user's details. The update may replace the whole record, so this tool " +
      "reads the existing user and merges on every update, then sends the merged record back in full; " +
      "it refuses to update when the existing record or account type cannot be read. " +
      "For sender-list changes use the block/allow list tools (users_block_list_add and the other " +
      "users_*_list_* tools) instead. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        email: { type: "string", description: "The user's email address." },
        data: {
          type: "object",
          additionalProperties: true,
          description: "Fields to update on the user.",
        },
      },
      required: ["orgDomain", "email", "data"],
    },
    annotations: HIGH_IMPACT_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_users_delete",
    description:
      "⚠ DESTRUCTIVE — IRREVERSIBLE. Permanently remove a user from an organization. " +
      "Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        email: { type: "string", description: "The user's email address." },
        ...CONFIRM_ARG_PROPERTY,
      },
      required: ["orgDomain", "email"],
    },
    annotations: DESTRUCTIVE_ANNOTATIONS,
  },

  ...senderListTools("users"),

  // ── Endpoint discovery ──────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_endpoint_discover",
    description:
      "Resolve which regional server instance (pod/region) hosts a given customer domain. " +
      "Use this before calling org-scoped tools if the org's region is unknown.",
    inputSchema: {
      type: "object",
      properties: { domain: domainProp },
      required: ["domain"],
    },
    annotations: READ_ANNOTATIONS,
  },

  // ── Features ────────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_features_get",
    description: "View the enabled product features for an organization.",
    inputSchema: {
      type: "object",
      properties: { orgDomain: orgDomainProp },
      required: ["orgDomain"],
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_features_update",
    description:
      "⚠ HIGH-IMPACT. Modify an organization's enabled features. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        features: {
          type: "object",
          additionalProperties: true,
          description: "Feature flags to set.",
        },
      },
      required: ["orgDomain", "features"],
    },
    annotations: HIGH_IMPACT_ANNOTATIONS,
  },

  // ── Licensing ───────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_licensing_get",
    description: "View an organization's license allocation.",
    inputSchema: {
      type: "object",
      properties: { orgDomain: orgDomainProp },
      required: ["orgDomain"],
    },
    annotations: READ_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_licensing_update",
    description:
      "⚠ HIGH-IMPACT. Modify an organization's license allocation. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        licensing: {
          type: "object",
          additionalProperties: true,
          description: "Licensing fields to set.",
        },
      },
      required: ["orgDomain", "licensing"],
    },
    annotations: HIGH_IMPACT_ANNOTATIONS,
  },

  // ── Package ─────────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_package_update",
    description:
      "⚠ HIGH-IMPACT. Change an organization's subscription tier/package. This affects " +
      "billing. Confirm with the user before invoking.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        package: {
          type: "object",
          additionalProperties: true,
          description: "Package/subscription-tier fields to set.",
        },
      },
      required: ["orgDomain", "package"],
    },
    annotations: HIGH_IMPACT_ANNOTATIONS,
  },

  // ── Reporting ───────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_reporting_get",
    description: "Get inbound/outbound email flow metrics (time-series) for an organization.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        start: { type: "string", description: "Start date (YYYY-MM-DD)." },
        end: { type: "string", description: "End date (YYYY-MM-DD)." },
        params: {
          type: "object",
          additionalProperties: true,
          description: "Additional query parameters, passed through verbatim.",
        },
      },
      required: ["orgDomain"],
    },
    annotations: READ_ANNOTATIONS,
  },

  // ── Token ───────────────────────────────────────────────────────────────
  {
    name: "proofpoint_essentials_token_create",
    description: "Mint an Odin-based SSO authentication token.",
    inputSchema: {
      type: "object",
      properties: {
        body: {
          type: "object",
          additionalProperties: true,
          description: "Optional request body for token minting.",
        },
      },
    },
    annotations: WRITE_ANNOTATIONS,
  },
];

/** Deterministic name list (used by tests and the smoke script). */
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);
