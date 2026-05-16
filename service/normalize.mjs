/**
 * Normalizes a prompt string into a stable, matchable form.
 *
 * Rules:
 * - lowercase
 * - collapse all whitespace sequences to a single space
 * - trim leading/trailing whitespace
 *
 * Intentionally minimal. Do not strip meaningful punctuation.
 */
export function normalizePrompt(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
