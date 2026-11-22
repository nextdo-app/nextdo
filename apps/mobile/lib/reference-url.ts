/**
 * Reference-link parsing (issue #90) — ONE parser shared by save, open and
 * display, so the three paths cannot disagree.
 *
 * `new URL()` is the platform parser (Hermes/React Native and browsers): it
 * rejects malformed authorities and invalid ports, normalizes IDNs and
 * lower-cases the scheme/host. A regex over the authority (the first draft)
 * accepted `https://example.com:invalid-port/path`.
 *
 * The library stores only absolute `http:` / `https:` links. Rows created
 * before this check (Clarify writes whatever the user typed) can still hold
 * any string; every reader must tolerate that by calling this parser.
 */
export interface ParsedReferenceUrl {
  url: URL;
  /** Host for display: `www.` stripped; a non-default port is kept. */
  domain: string;
}

/** Parse a stored or typed reference URL; null when it is not a usable link. */
export function parseReferenceUrl(value: string): ParsedReferenceUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  return { url, domain: url.host.replace(/^www\./i, '') };
}

/** The row's display domain; null for a missing or invalid link. */
export function referenceDomain(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return parseReferenceUrl(value)?.domain ?? null;
}
