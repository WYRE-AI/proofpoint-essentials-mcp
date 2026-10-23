// Bound regex work on untrusted input (CWE-1333). Output is capped at 300 code points,
// and redaction only ever shortens text, so nothing past this bound can reach the output
// except via a cut fragment, which the patterns below still match and redact.
const MAX_INPUT_CODE_UNITS = 8192;

/** Redact supported email spellings and optional hostnames before limiting text. */
export function sanitize(text: string, opts?: { redactHostnames?: boolean }): string {
  let cleaned = String(text);
  if (cleaned.length > MAX_INPUT_CODE_UNITS) {
    cleaned = cleaned.slice(0, MAX_INPUT_CODE_UNITS).replace(/[\uD800-\uDBFF]$/, "");
  }
  cleaned = cleaned.replace(/%2540|%40|&#64;|&#x40;|&commat;|\\u0040|＠/gi, "@");
  // Quoted locals must be consumed first, including any @ inside the quotes.
  cleaned = cleaned.replace(
    /(?:"(?:[^"\\]|\\.)*"|(?<![^\s<>"(),;:@])[^\s<>"(),;:@]+)\s*@\s*(?:\[[^\]\s]+\]|[^\s<>"(),;:@]+)/g,
    "[redacted-email]"
  );
  if (opts?.redactHostnames) {
    cleaned = cleaned.replace(
      /(?<![a-z0-9-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?\b/gi,
      "[redacted-domain]"
    );
  }
  return Array.from(cleaned).slice(0, 300).join("");
}
