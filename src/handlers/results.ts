/** Shared tool-result helpers and argument validation. */

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /** The SDK's CallToolResult carries an open index signature — mirror it. */
  [key: string]: unknown;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
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
