import { describe, expect, it, vi } from 'vitest';
import { integrationEndpoint, RemoteServices } from '../src/integrations/client';
import { DEFAULT_CONFIG, resolveConfig, validateConfig } from '../src/enterprise/config';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
describe('explicit outbound services', () => {
  it('sends nothing with defaults and validates approved endpoints and managed enablement', async () => {
    const fetcher = vi.fn<typeof fetch>(); const client = new RemoteServices(() => DEFAULT_CONFIG, fetcher);
    expect((await client.trust('Playwright-like')).status).toBe('unavailable');
    expect((await client.declaration('https://example.com/PRIVATE')).status).toBe('unavailable');
    await expect(client.contribute({ sessionsObserved: 1, confirmedContainments: 0, firstSessionAt: 123, frameworks: {} })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    for (const value of ['http://example.com', 'https://user:SECRET@example.com', 'https://127.0.0.1', 'https://localhost', 'https://[::1]', 'https://example.com/?token=SECRET', 'https://example.com:8080']) expect(() => integrationEndpoint(value)).toThrow();
    expect(integrationEndpoint('https://example.com/')).toBe('https://example.com');
    expect(() => validateConfig({ ...DEFAULT_CONFIG, trustLookupEnabled: true })).toThrow();
    expect(resolveConfig({ ...DEFAULT_CONFIG, siteDeclarationsEnabled: true }, { siteDeclarationsEnabled: false }).values.siteDeclarationsEnabled).toBe(false);
  });
  it('queries a fixed framework label, bounds results, omits credentials and never upgrades controller identity', async () => {
    let config = { ...DEFAULT_CONFIG, trustLookupEnabled: true, trustEndpoint: 'https://registry.example.com' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json([{ name: 'playwright', trustLevel: 4, displayName: 'PRIVATE_VENDOR' }]));
    const client = new RemoteServices(() => config, fetcher);
    const result = await client.trust('Playwright-like');
    expect(result).toMatchObject({ status: 'listed', registryLevel: 4, controllerVerified: false });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(fetcher).toHaveBeenCalledWith('https://registry.example.com/api/v1/registry/search?q=playwright', expect.objectContaining({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }));
    await client.trust('Playwright-like'); expect(fetcher).toHaveBeenCalledOnce();
    config = { ...config, trustProvider: 'aim' };
    fetcher.mockResolvedValueOnce(json({ trustScore: 2, name: 'PRIVATE' }));
    expect((await client.trust('Playwright-like')).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(json({ trustScore: 0.8, name: 'PRIVATE' }));
    expect((await client.trust('Playwright-like')).score).toBe(0.8);
  });
  it('reads only fixed declaration claims and never follows links or relaxes policy', async () => {
    const config = { ...DEFAULT_CONFIG, siteDeclarationsEnabled: true, policyMode: 'block' as const };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('AI-Safe: invalid\nAI-Safe: true\nInjection-Protected: false\nConsistent-Rendering: true\nContact: mailto:PRIVATE@example.com\nAttestation: https://PRIVATE.example.com', { headers: { 'Content-Type': 'text/plain' } }));
    const client = new RemoteServices(() => config, fetcher);
    const value = await client.declaration('https://example.com/PRIVATE?token=SECRET');
    expect(value).toEqual({ status: 'claims', claims: { 'injection-protected': false, 'consistent-rendering': true }, verified: false });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.com/.well-known/ai-safety.txt');
    await client.declaration('https://example.com/other'); expect(fetcher).toHaveBeenCalledOnce();
    expect((await client.declaration('http://example.com')).status).toBe('unavailable');
    expect(config.policyMode).toBe('block');
  });
  it('rejects oversized responses and uploads only bounded aggregate counts after opt-in', async () => {
    const config = { ...DEFAULT_CONFIG, trustLookupEnabled: true, trustEndpoint: 'https://registry.example.com', contributionsEnabled: true, contributionEndpoint: 'https://stats.example.com/ingest' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ padding: 'X'.repeat(20_000) })).mockResolvedValueOnce(json({ received: true }));
    const client = new RemoteServices(() => config, fetcher);
    expect((await client.trust('Playwright-like')).status).toBe('unavailable');
    await client.contribute({ firstSessionAt: 12345, sessionsObserved: 2, confirmedContainments: 1, frameworks: { 'Playwright-like': 2 } });
    const payload = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
    expect(Object.keys(payload).sort()).toEqual(['confirmedContainments', 'frameworkCounts', 'schemaVersion', 'sessionsObserved']);
    expect(JSON.stringify(payload)).not.toMatch(/12345|domain|tabId|token|timestamp/);
    await expect(client.contribute({ firstSessionAt: null, sessionsObserved: 2, confirmedContainments: 1, frameworks: {} })).rejects.toThrow();
  });
});
