import type { AgentGuardConfig } from '../shared/contracts';
import type { Framework } from '../shared/intelligence';
import type { SiteDeclaration, TrustLookup } from '../shared/integrations';
import type { BrowserStatistics } from '../shared/reports';

export function integrationEndpoint(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Invalid integration endpoint');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443' ||
    !url.hostname.includes('.') || /^[\d.]+$/u.test(url.hostname) || url.hostname.includes(':') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(url.hostname)) throw new Error('Use an approved HTTPS endpoint without credentials, query or fragment');
  return url.href.replace(/\/$/u, '');
}
const names: Record<Framework, string> = { 'Playwright-like': 'playwright', 'Puppeteer-like': 'puppeteer', 'Selenium-like': 'selenium', 'WebDriver-compatible': 'webdriver' };
async function boundedText(response: Response, cap = 16_384): Promise<string> {
  if (Number(response.headers.get('content-length')) > cap || !response.body) throw new Error('Response unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, output = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > cap) throw new Error('Response too large');
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** No automatic calls. Packaged UI must request each lookup/contribution explicitly. */
export class RemoteServices {
  private cache = new Map<string, { until: number; value: TrustLookup }>();
  private declarationCache = new Map<string, { until: number; value: SiteDeclaration }>();
  private contributionPending = false;
  private lastContribution = 0;
  constructor(private readonly config: () => AgentGuardConfig, private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
  private async request(url: string, type: 'application/json' | 'text/plain', payload?: unknown): Promise<{ status: number; text: string }> {
    const response = await this.fetcher(url, { method: payload === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      headers: payload === undefined ? { Accept: type } : { Accept: type, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return { status: 404, text: '' };
    if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== type) throw new Error('Response unavailable');
    return { status: response.status, text: await boundedText(response) };
  }
  async trust(framework: Framework): Promise<TrustLookup> {
    const config = this.config(), provider = config.trustProvider ?? 'registry';
    const empty: TrustLookup = { framework, provider, status: 'unavailable', score: null, registryLevel: null, controllerVerified: false };
    if (!config.trustLookupEnabled || !Object.hasOwn(names, framework)) return empty;
    try {
      const endpoint = integrationEndpoint(config.trustEndpoint); if (!endpoint) return empty;
      const key = `${provider}:${endpoint}:${framework}`;
      const cached = this.cache.get(key); if (cached && cached.until > this.now()) return { ...cached.value };
      const name = names[framework];
      const url = provider === 'aim' ? `${endpoint}/api/v1/agents/${name}` : `${endpoint}/api/v1/registry/search?q=${name}`;
      const response = await this.request(url, 'application/json');
      let result = empty;
      if (response.status === 404) result = { ...empty, status: 'not_listed' };
      else {
        const data: unknown = JSON.parse(response.text);
        if (provider === 'aim') {
          if (!object(data) || typeof data.trustScore !== 'number' || !Number.isFinite(data.trustScore) || data.trustScore < 0 || data.trustScore > 1) throw new Error('Invalid trust result');
          result = { ...empty, status: 'listed', score: data.trustScore };
        } else {
          if (!Array.isArray(data) || data.length > 100) throw new Error('Invalid registry result');
          const matches = data.filter(item => object(item) && item.name === name);
          if (matches.length === 0) result = { ...empty, status: 'not_listed' };
          else if (matches.length === 1 && Number.isInteger(matches[0].trustLevel) && matches[0].trustLevel >= 0 && matches[0].trustLevel <= 4) result = { ...empty, status: 'listed', registryLevel: matches[0].trustLevel as number };
        }
      }
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: this.now() + (result.status === 'unavailable' ? 60_000 : 5 * 60_000), value: result });
      return { ...result };
    } catch { return empty; }
  }
  async declaration(pageUrl: string): Promise<SiteDeclaration> {
    const empty: SiteDeclaration = { status: 'unavailable', claims: {}, verified: false };
    if (!this.config().siteDeclarationsEnabled) return empty;
    try {
      const url = new URL(pageUrl);
      if (url.protocol !== 'https:') return empty;
      const origin = integrationEndpoint(url.origin); if (!origin) return empty;
      const cached = this.declarationCache.get(origin); if (cached && cached.until > this.now()) return structuredClone(cached.value);
      const response = await this.request(`${origin}/.well-known/ai-safety.txt`, 'text/plain');
      const claims: SiteDeclaration['claims'] = {}, seen = new Set<string>();
      for (const line of response.text.split(/\r?\n/u)) {
        if (line.trimStart().startsWith('#')) continue;
        const match = /^\s*(ai-safe|injection-protected|consistent-rendering)\s*:\s*(.*?)\s*$/iu.exec(line);
        if (!match) continue;
        const key = match[1]!.toLowerCase() as keyof SiteDeclaration['claims'];
        if (seen.has(key)) continue; seen.add(key);
        if (match[2] === 'true' || match[2] === 'false') claims[key] = match[2] === 'true';
      }
      const value: SiteDeclaration = { status: Object.keys(claims).length ? 'claims' : 'no_usable_claims', claims, verified: false };
      if (this.declarationCache.size >= 100) this.declarationCache.delete(this.declarationCache.keys().next().value!);
      this.declarationCache.set(origin, { until: this.now() + 24 * 60 * 60_000, value });
      return structuredClone(value);
    } catch { return empty; }
  }
  async contribute(statistics: BrowserStatistics): Promise<void> {
    const config = this.config();
    if (!config.contributionsEnabled || this.contributionPending || this.lastContribution > this.now() - 60_000) throw new Error('Contribution disabled or rate limited');
    const endpoint = integrationEndpoint(config.contributionEndpoint); if (!endpoint) throw new Error('No contribution endpoint');
    const count = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid aggregate'); return Math.min(value, 1_000_000_000); };
    const frameworkCounts = Object.fromEntries(Object.keys(names).map(framework => [framework, count(statistics.frameworks[framework as Framework] ?? 0)]));
    const payload = { schemaVersion: 1, sessionsObserved: count(statistics.sessionsObserved), confirmedContainments: count(statistics.confirmedContainments), frameworkCounts };
    this.contributionPending = true;
    try {
      const response = await this.request(endpoint, 'application/json', payload);
      if (response.status === 404) throw new Error('Contribution endpoint unavailable');
      const receipt: unknown = JSON.parse(response.text);
      if (!object(receipt) || receipt.received !== true) throw new Error('Contribution receipt unavailable');
      this.lastContribution = this.now();
    }
    finally { this.contributionPending = false; }
  }
}
