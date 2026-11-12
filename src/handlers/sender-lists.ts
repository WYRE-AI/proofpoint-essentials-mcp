/**
 * Block/allow list changes on the dedicated sender-lists resources: read, change
 * one list, write, re-read to verify. Not atomic; the last writer wins.
 */
import { isIPv4 } from "node:net";
import type { ProofpointEssentialsClient, SenderLists } from "@wyre-ai/node-proofpoint-essentials";
import {
  errorResult,
  jsonResult,
  requireEmailSegment,
  requirePathSegment,
  requireStringArray,
  ToolInputError,
  type ToolResult,
} from "./results.js";

const MAX_ENTRIES = 100;
const MAX_ENTRY_LENGTH = 320;
const LOCAL_PART = /^[a-z0-9.!#$%&*+/=?^_`{|}~-]{1,64}$/i;
/** Up to three digits without leading zeros, as isIPv4 requires for plain addresses. */
const CANONICAL_NUMBER = /^(0|[1-9]\d{0,2})$/;
const DOMAIN_LABEL =/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

type Lists = Required<SenderLists>;

function domainProblem(host: string): string | null {
  if (host.length > 253) return "domain must be at most 253 characters";
  const labels = host.split(".");
  if (labels.some((label) => label.includes("*"))) {
    return "host wildcards are not supported; list the domain itself";
  }
  if (labels.length < 2) return "domain needs at least two labels separated by dots";
  if (labels.some((label) => label.length > 63 || !DOMAIN_LABEL.test(label))) {
    return "each domain label must be 1 to 63 ASCII letters, digits or hyphens, and must not start or end with a hyphen";
  }
  if (!/^[a-z]/i.test(labels[labels.length - 1])) return "the domain's last label must start with a letter";
  return null;
}

function cidrProblem(entry: string): string | null {
  const [ip, prefix, ...extra] = entry.split("/");
  if (extra.length > 0 || !isIPv4(ip) || !CANONICAL_NUMBER.test(prefix)) {
    return "CIDR must be a valid IPv4 address, a slash, and a prefix";
  }
  if (Number(prefix) > 32) return "CIDR prefix must be between 24 and 32";
  if (Number(prefix) < 24) return "ranges larger than /24 are not allowed";
  return null;
}

/** Only a.b.c.* and a.b.*.* with numeric octets are supported wildcards. */
function ipv4WildcardProblem(entry: string): string | null {
  const [a, b, c, d, ...extra] = entry.split(".");
  const octet = (part: string | undefined) => CANONICAL_NUMBER.test(part ?? "") && Number(part) <= 255;
  return extra.length === 0 && d === "*" && octet(a) && octet(b) && (c === "*" || octet(c))
    ? null
    : "IPv4 wildcards must be a.b.c.* or a.b.*.* with numbers from 0 to 255";
}

/** Why an entry is not a supported sender entry, or null when it is valid. */
function entryProblem(entry: string): string | null {
  if (entry.length < 1 || entry.length > MAX_ENTRY_LENGTH) return `entry must be 1 to ${MAX_ENTRY_LENGTH} characters`;
  if (/[\s<>"']|\p{Cc}/u.test(entry)) {
    return "entry must not contain whitespace, control characters, or any of < > \" '";
  }
  if (entry.includes(":")) return "IPv6 entries are not supported";
  const at = entry.lastIndexOf("@");
  if (at >= 0) {
    return LOCAL_PART.test(entry.slice(0, at))
      ? domainProblem(entry.slice(at + 1))
      : "email local part must be 1 to 64 characters from a-z, 0-9 and . ! # $ % & * + / = ? ^ _ ` { | } ~ -";
  }
  if (entry.includes("/")) return cidrProblem(entry);
  if (/^[\d.*]+$/.test(entry)) {
    if (entry.includes("*")) return ipv4WildcardProblem(entry);
    return isIPv4(entry) ? null : "not a valid IPv4 address";
  }
  return domainProblem(entry);
}

/** Validated entries, de-duplicated case-insensitively with the first spelling winning. */
function requireEntries(args: Record<string, unknown>): string[] {
  const given = requireStringArray(args, "entries");
  const unique = new Map<string, { entry: string; position: number }>();
  given.forEach((entry, index) => {
    const key = entry.toLowerCase();
    if (!unique.has(key)) unique.set(key, { entry, position: index + 1 });
  });
  if (unique.size > MAX_ENTRIES) {
    throw new ToolInputError(`entries must contain at most ${MAX_ENTRIES} distinct entries; got ${unique.size}.`);
  }
  for (const { entry, position } of unique.values()) {
    const problem = entryProblem(entry);
    if (problem !== null) {
      // The position survives the dispatcher's email redaction, which hides the entry itself.
      throw new ToolInputError(
        `Invalid entry ${position} of ${given.length} ${JSON.stringify(entry.slice(0, 80))}: ${problem}`
      );
    }
  }
  return [...unique.values()].map(({ entry }) => entry);
}

/**
 * Copy a sender-lists response, refusing anything that is not clearly a pair of string lists.
 * Known limit: an empty object (or a 204 / empty body, which the SDK returns as {}) and a
 * missing key both read as an empty list, so an upstream that answers with nothing is
 * indistinguishable from two empty lists.
 */
function snapshot(value: unknown): Lists {
  const unreadable = () => new ToolInputError("Existing sender lists could not be read safely; refusing update.");
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw unreadable();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length > 0 && !("allow_list" in record) && !("block_list" in record)) throw unreadable();
  const read = (key: "allow_list" | "block_list"): string[] => {
    const list = record[key];
    if (list === undefined) return [];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) throw unreadable();
    return [...list];
  };
  return { allow_list: read("allow_list"), block_list: read("block_list") };
}

const includesEntry = (list: string[], entry: string) =>
  list.some((item) => item.toLowerCase() === entry.toLowerCase());

/**
 * Compare a list with what it should hold, case-insensitively as sets. The text is
 * counts plus one short sample so that the whole error survives the dispatcher's
 * 300-character cap (it also redacts email-shaped entries, so listing them says little).
 */
function describeDifference(name: string, expected: string[], actual: string[]): string | null {
  const expectedKeys = new Set(expected.map((item) => item.toLowerCase()));
  const actualKeys = new Set(actual.map((item) => item.toLowerCase()));
  const missing = expected.filter((item) => !actualKeys.has(item.toLowerCase()));
  const unexpected = actual.filter((item) => !expectedKeys.has(item.toLowerCase()));
  if (missing.length === 0 && unexpected.length === 0) return null;
  const first = Array.from(missing[0] ?? unexpected[0]).slice(0, 30).join("");
  return `the ${name} list differs: ${missing.length} missing, ${unexpected.length} unexpected (first: ${first})`;
}

/** Read the lists, add or remove entries on one list, write both, then re-read to verify. */
export async function changeSenderList(
  client: ProofpointEssentialsClient,
  args: Record<string, unknown>,
  scope: "user" | "org",
  list: "allow" | "block",
  action: "add" | "remove"
): Promise<ToolResult> {
  const orgDomain = requirePathSegment(args, "orgDomain");
  const email = scope === "user" ? requireEmailSegment(args, "email") : undefined;
  const entries = requireEntries(args);
  const target = list === "allow" ? "allow_list" : "block_list";
  const opposite = list === "allow" ? "block_list" : "allow_list";

  const read = async () => snapshot(email === undefined
    ? await client.senderLists.getOrg(orgDomain)
    : await client.senderLists.getUser(orgDomain, email));
  const before = await read();

  const present = entries.filter((entry) => includesEntry(before[target], entry));
  const absent = entries.filter((entry) => !includesEntry(before[target], entry));
  const changes = action === "add" ? absent : present;
  const skipped = action === "add" ? present : absent;

  const report = (now: Lists, written: boolean) => ({
    orgDomain,
    ...(email === undefined ? {} : { email }),
    list,
    changed: written,
    ...(written ? { verified: true } : {}),
    ...(action === "add"
      ? {
        added: changes,
        skipped_already_present: skipped,
        [`also_on_${opposite}`]: entries.filter((entry) => includesEntry(before[opposite], entry)),
      }
      : { removed: changes, skipped_not_present: skipped }),
    counts: { allow_list: now.allow_list.length, block_list: now.block_list.length },
    // Upstream data is echoed only when it is as small as a valid request could be.
    ...(now[target].length <= MAX_ENTRIES && now[target].every((item) => item.length <= MAX_ENTRY_LENGTH)
      ? { entries: now[target] }
      : { entries_omitted: true }),
  });

  if (changes.length === 0) return jsonResult(report(before, false));

  const changed = new Set(changes.map((entry) => entry.toLowerCase()));
  const updated = action === "add"
    ? [...before[target], ...changes]
    : before[target].filter((item) => !changed.has(item.toLowerCase()));
  // Whether PATCH merges or replaces is unverified against a live account.
  // Sending both lists (the target as modified, the other exactly as read) is
  // correct under either behaviour.
  const lists: Lists = { ...before, [target]: updated };
  if (email === undefined) await client.senderLists.updateOrg(orgDomain, lists, "PATCH");
  else await client.senderLists.updateUser(orgDomain, email, lists, "PATCH");

  let after: Lists;
  try {
    after = await read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return errorResult(`Sender-list write could not be confirmed: the lists could not be re-read (${reason}). Check the current lists before retrying.`);
  }
  // The opposite list comes first: it is the more important half of a failure.
  const problems = [
    describeDifference(list === "allow" ? "block" : "allow", before[opposite], after[opposite]),
    describeDifference(list, updated, after[target]),
  ].filter((problem): problem is string => problem !== null);
  if (problems.length > 0) {
    return errorResult(`Sender-list write could not be confirmed: ${problems.join("; ")}. May be partly applied; check the lists.`);
  }
  return jsonResult(report(after, true));
}
