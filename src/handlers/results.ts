/** Shared tool-result helpers and argument validation. */
import { sanitize } from "../utils/sanitize.js";
import type { BatchItemResult } from "@wyre-ai/node-proofpoint-essentials";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /** The SDK's CallToolResult carries an open index signature — mirror it. */
  [key: string]: unknown;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function batchCreateResult(
  kind: "user" | "domain",
  results: BatchItemResult[],
  requested: number
): ToolResult {
  const summary = {
    requested: Math.max(requested, results.length),
    returned: results.length,
    succeeded: 0,
    failed: 0,
    unconfirmed: Math.max(0, requested - results.length),
  };
  const redacted = results.map((item, index) => {
    const record = item !== null && typeof item === "object" ? item : {};
    const codes = [record.status, record.code].filter((value): value is number => typeof value === "number");
    let outcome: "succeeded" | "failed" | "unconfirmed";
    const hasError = (value: unknown): boolean =>
      value !== undefined && value !== null && value !== "" && value !== false &&
      !(Array.isArray(value) && value.length === 0);
    if (hasError(record.error) || hasError((record as { errors?: unknown }).errors) || record.success === false || codes.some((code) => code < 200 || code >= 300)) {
      outcome = "failed";
    } else if (record.success === true || codes.length > 0) {
      outcome = "succeeded";
    } else {
      outcome = "unconfirmed";
    }
    summary[outcome]++;
    const error = record.error;
    const errorMessage = error !== null && typeof error === "object" && "message" in error
      ? error.message : error;
    const message = [typeof item === "string" ? item : undefined, record.message, errorMessage, record.detail, record.reason, record.description]
      .find((value): value is string => typeof value === "string");
    return {
      index,
      outcome,
      ...(typeof record.status === "number" ? { status: record.status } : {}),
      ...(typeof record.code === "number" ? { code: record.code } : {}),
      ...(message !== undefined ? {
        message: sanitize(message, { redactHostnames: kind === "domain" }),
      } : {}),
    };
  });
  const result = jsonResult({ summary, results: summary.succeeded === results.length && summary.unconfirmed === 0 ? results : redacted });
  if (summary.failed > 0) {
    result.isError = true;
    result.content[0].text =
      `${summary.failed} of ${summary.requested} ${kind} create items failed; ` +
      `${summary.succeeded} succeeded and should not be retried` +
      (summary.unconfirmed > 0 ? `; ${summary.unconfirmed} unconfirmed` : "") +
      ". See results for per-item errors.\n\n" +
      result.content[0].text;
  }
  return result;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Thrown for invalid tool arguments; the dispatcher maps it to isError. */
export class ToolInputError extends Error {}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolInputError(`Argument "${key}" is required and must be a non-empty string.`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`Argument "${key}" must be a string.`);
  }
  return value;
}

export function requireBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") {
    throw new ToolInputError(`Argument "${key}" is required and must be a boolean.`);
  }
  return value;
}

export function requireObject(
  args: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = args[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`Argument "${key}" is required and must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function optionalObject(
  args: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`Argument "${key}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string")) {
    throw new ToolInputError(
      `Argument "${key}" is required and must be a non-empty array of strings.`
    );
  }
  return value as string[];
}

export function requireObjectArray(
  args: Record<string, unknown>,
  key: string
): Record<string, unknown>[] {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))
  ) {
    throw new ToolInputError(
      `Argument "${key}" is required and must be a non-empty array of objects.`
    );
  }
  return value as Record<string, unknown>[];
}
