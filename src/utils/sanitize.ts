/** Redact supported email spellings and optional hostnames before limiting text. */
export function sanitize(text: string, opts?: { redactHostnames?: boolean }): string {
  let cleaned = text.replace(/%2540|%40|&#64;|&#x40;|&commat;|\\u0040|＠/gi, "@");
  // Quoted locals must be consumed first, including any @ inside the quotes.
  cleaned = cleaned.replace(
    /(?:"(?:[^"\\]|\\.)*"|[^\s<>"(),;:@]+)\s*@\s*(?:\[[^\]\s]+\]|[^\s<>"(),;:@]+)/g,
    "[redacted-email]"
  );
  if (opts?.redactHostnames) {
    cleaned = cleaned.replace(
      /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?\b/gi,
      "[redacted-domain]"
    );
  }
  return Array.from(cleaned).slice(0, 300).join("");
}
