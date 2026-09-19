/** Return only a canonical HTTP(S) hostname; never retain a URL or its path. */
export function domainFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
}

/** Normalize a hostname or a `*.hostname` policy rule, not a URL. */
export function normalizeDomain(input: string): string {
  if (typeof input !== 'string') throw new Error('Domain must be a string');
  const raw = input.trim();
  const withoutWildcard = raw.startsWith('*.') ? raw.slice(2) : raw;
  if (!withoutWildcard || /[\s/@:?#\\*%]/u.test(withoutWildcard)) {
    throw new Error('Domain must be a hostname without a scheme, port, path or query');
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${withoutWildcard}`).hostname.toLowerCase();
  } catch {
    throw new Error('Invalid hostname');
  }
  hostname = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (hostname.length > 253 || hostname.length === 0) throw new Error('Invalid hostname length');
  const labels = hostname.split('.');
  if (labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) {
    throw new Error('Invalid hostname label');
  }
  return hostname;
}

/** Match at DNS label boundaries; example.com does not match notexample.com. */
export function matchesDomain(host: string, rule: string): boolean {
  try {
    const normalizedHost = normalizeDomain(host);
    const normalizedRule = normalizeDomain(rule);
    return normalizedHost === normalizedRule || normalizedHost.endsWith(`.${normalizedRule}`);
  } catch {
    return false;
  }
}
