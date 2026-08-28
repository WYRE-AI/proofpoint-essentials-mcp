/**
 * The complete Proofpoint Essentials tool surface — 20 tools, FLAT (no router).
 *
 * Deterministic ordering rule: all tools live in this single module-scope
 * `TOOLS` array, grouped by resource (orgs, domains, users, endpoints,
 * features, licensing, package, reporting, token), reads before writes
 * within each group. `tools/list` returns this array by reference for every
 * request, every era, every caller. Never sorted at runtime, never filtered
 * per-session, never varied by credentials.
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
 *     updates): "⚠ HIGH-IMPACT." prefix, `idempotentHint: true`, warning
 *     label only — no runtime confirmation gate.
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
      "Add one or more domains to an organization (batch create). The API may return a " +
      "207 partial-success response; per-item results are returned verbatim.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        domains: {
          type: "array",
          items: { type: "string" },
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
      "Add one or more users to an organization (batch create). The API may return a 207 " +
      "partial-success response; per-item results are returned verbatim.",
    inputSchema: {
      type: "object",
      properties: {
        orgDomain: orgDomainProp,
        users: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            description: "User fields, typically including email, firstname, lastname.",
          },
          description: "User objects to create.",
        },
      },
      required: ["orgDomain", "users"],
    },
    annotations: WRITE_ANNOTATIONS,
  },
  {
    name: "proofpoint_essentials_users_update",
    description: "⚠ HIGH-IMPACT. Update a user's details. Confirm with the user before invoking.",
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
