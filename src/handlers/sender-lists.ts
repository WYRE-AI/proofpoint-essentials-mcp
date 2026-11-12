/** Safe read/modify/PATCH operations on dedicated sender-list resources. */
import { isIPv4 } from "node:net";
import type { ProofpointEssentialsClient, SenderLists } from "@wyre-ai/node-proofpoint-essentials";
import {
  jsonResult,
  requireEmailSegment,
  requirePathSegment,
  requireString,
  requireStringArray,
  ToolInputError,
  type ToolResult,
} from "./results.js";

/** Validate supported sender entries without whitespace or injection characters. */
function validEntry(entry: string): boolean {
  if (!entry || /[\s<>"']/.test(entry) || [...entry].some(char => {
    const code = char.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  })) return false;
  const host = "(?:[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?\\.)+[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?";
  if (new RegExp(`^(?:[a-z0-9.!#$%&*+/=?^_\x60{|}~-]+@)?${host}$`, "i").test(entry)) {
    // Numeric addresses and CIDRs must pass IPv4 validation below.
    if (!/^[\d.]+$/.test(entry)) return true;
  }
  if (/^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9*-]+$/i.test(entry)) return true;
  const [ip, prefix, ...extra] = entry.split("/");
  return isIPv4(ip) && extra.length === 0 &&
    (prefix === undefined || /^(?:[0-9]|[12][0-9]|3[0-2])$/.test(prefix));
}

/** Validate and copy both lists before modifying the dedicated resource. */
function snapshot(lists: SenderLists): Required<SenderLists> {
  for (const key of ["allow_list", "block_list"] as const) {
    if (lists[key] !== undefined && (!Array.isArray(lists[key]) || !lists[key]!.every(v => typeof v === "string"))) {
      throw new ToolInputError("Existing sender lists could not be read safely; refusing update.");
    }
  }
  return { allow_list: [...(lists.allow_list ?? [])], block_list: [...(lists.block_list ?? [])] };
}

/** GET-merge-PATCH sender entries, removing opposite-list matches on add. */
export async function changeSenderList(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  scope: "user" | "org",
  action: "add" | "remove"
): Promise<ToolResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
  const email = scope === "user" ? requireEmailSegment(args, "email") : undefined;
  const list = requireString(args, "list");
  if (list !== "allow" && list !== "block") throw new ToolInputError('list must be "allow" or "block".');
  const entries = requireStringArray(args, "entries");
  if (!entries.every(validEntry)) throw new ToolInputError("entries must contain valid emails, domains, IPv4 addresses, CIDRs, or Proofpoint wildcards without whitespace, control characters, or injection characters.");
  const before = snapshot(email === undefined
    ? await client.senderLists.getOrg(orgDomain)
    : await client.senderLists.getUser(orgDomain, email));
  const after = snapshot(before);
  const target = list === "allow" ? "allow_list" : "block_list";
  const opposite = list === "allow" ? "block_list" : "allow_list";
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    const matches = (value: string) => value.toLowerCase() === entry.toLowerCase();
    const present = after[target].some(matches);
    if (action === "add") {
      if (present) skipped.push(entry);
      else { after[target].push(entry); changed.push(entry); }
      after[opposite] = after[opposite].filter(value => !matches(value));
    } else if (present) {
      after[target] = after[target].filter(value => !matches(value));
      changed.push(entry);
    } else skipped.push(entry);
  }
  if (email === undefined) await client.senderLists.updateOrg(orgDomain, after, "PATCH");
  else await client.senderLists.updateUser(orgDomain, email, after, "PATCH");
  return jsonResult({ orgDomain, ...(email === undefined ? {} : { email }), list,
    ...(action === "add" ? { added: changed, skipped_already_present: skipped }
      : { removed: changed, skipped_not_present: skipped }), before, after });
}
