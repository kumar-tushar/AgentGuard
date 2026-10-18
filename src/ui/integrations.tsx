import { useState } from 'react';
import type { Dashboard, TabAgentStatus } from '../shared/contracts';
import type { SiteDeclaration, TrustLookup, TrustProvider } from '../shared/integrations';
import { errorText, send } from './client';
import { Notice } from './components';

export function Integrations({ dashboard, tabs, onChanged }: { dashboard: Dashboard; tabs: TabAgentStatus[]; onChanged(): void }) {
  const config = dashboard.config.values;
  const [endpoint, setEndpoint] = useState(config.trustEndpoint ?? '');
  const [provider, setProvider] = useState<TrustProvider>(config.trustProvider ?? 'registry');
  const [trustEnabled, setTrustEnabled] = useState(config.trustLookupEnabled ?? false);
  const [contributionEndpoint, setContributionEndpoint] = useState(config.contributionEndpoint ?? '');
  const [contributionEnabled, setContributionEnabled] = useState(config.contributionsEnabled ?? false);
  const [declarations, setDeclarations] = useState(config.siteDeclarationsEnabled ?? false);
  const [tabId, setTabId] = useState<number | null>(null);
  const [results, setResults] = useState<TrustLookup[] | null>(null);
  const [declaration, setDeclaration] = useState<SiteDeclaration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = (key: keyof typeof config) => busy || dashboard.config.managedKeys.includes(key);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); setMessage(null); try { await work(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  return <section className="panel"><h2>Optional external services</h2>
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice>{message}</Notice>}
    <Notice tone="warning">Disabled by default. No organization-wide backend is connected. Lookup sends fixed framework names to your configured endpoint, not tab domains or page contents. Returned scores describe a tooling type, never the identity or trustworthiness of a current controller. Site declarations are self-asserted and never relax policy.</Notice>
    <label className="field"><span>Trust provider protocol</span><select value={provider} disabled={locked('trustProvider')} onChange={event => setProvider(event.target.value as TrustProvider)}><option value="registry">OpenA2A registry protocol</option><option value="aim">AIM protocol</option></select></label>
    <label className="field"><span>Approved trust server base URL</span><input type="url" placeholder="https://your-approved-server.example" value={endpoint} disabled={locked('trustEndpoint')} onChange={event => setEndpoint(event.target.value)} /></label>
    <label className="toggle-field"><span>Enable manual trust lookups</span><input type="checkbox" checked={trustEnabled} disabled={locked('trustLookupEnabled')} onChange={event => setTrustEnabled(event.target.checked)} /></label>
    <label className="toggle-field"><span>Enable manual HTTPS site-declaration checks</span><input type="checkbox" checked={declarations} disabled={locked('siteDeclarationsEnabled')} onChange={event => setDeclarations(event.target.checked)} /></label>
    <label className="field"><span>Approved aggregate contribution endpoint</span><input type="url" value={contributionEndpoint} disabled={locked('contributionEndpoint')} onChange={event => setContributionEndpoint(event.target.value)} /></label>
    <label className="toggle-field"><span>Enable explicit aggregate contributions</span><input type="checkbox" checked={contributionEnabled} disabled={locked('contributionsEnabled')} onChange={event => setContributionEnabled(event.target.checked)} /></label>
    <button className="button button-primary" disabled={busy} onClick={() => void run(async () => { await send({ type: 'SAVE_CONFIG', config: { ...config, trustProvider: provider, trustEndpoint: endpoint || null, trustLookupEnabled: trustEnabled, siteDeclarationsEnabled: declarations, contributionsEnabled: contributionEnabled, contributionEndpoint: contributionEndpoint || null } }); onChanged(); setMessage('Integration settings saved. No lookup or contribution is sent automatically.'); })}>Save integration settings</button>
    <label className="field"><span>Lookup tab</span><select aria-label="Lookup tab" value={tabId ?? ''} onChange={event => { setTabId(Number(event.target.value)); setResults(null); setDeclaration(null); }}><option value="" disabled>Select a tab</option>{tabs.filter(tab => tab.domain).map(tab => <option key={tab.tabId} value={tab.tabId}>{tab.domain} · tab {tab.tabId}</option>)}</select></label>
    <div className="action-row"><button className="button button-outline" disabled={busy || tabId === null || !config.trustLookupEnabled} onClick={() => void run(async () => setResults(await send({ type: 'LOOKUP_TRUST', tabId: tabId! })))}>Look up framework types</button><button className="button button-outline" disabled={busy || tabId === null || !config.siteDeclarationsEnabled} onClick={() => { if (window.confirm('Fetch only /.well-known/ai-safety.txt from this tab’s current HTTPS origin, without credentials or referrer? No page body or linked attestation will be read.')) void run(async () => setDeclaration(await send({ type: 'LOOKUP_SITE_DECLARATION', tabId: tabId! }))); }}>Check site declaration</button></div>
    {results && (results.length ? <ul>{results.map(result => <li key={result.framework}>{result.framework} · {result.provider} · {result.status.replaceAll('_', ' ')}{result.score !== null ? ` · provider score ${result.score}` : ''}{result.registryLevel !== null ? ` · registry level ${result.registryLevel}/4` : ''} · current controller unverified</li>)}</ul> : <p>No supported framework hint is available for this tab.</p>)}
    {declaration && <p role="status">Site declaration: {declaration.status.replaceAll('_', ' ')}. {Object.entries(declaration.claims).map(([key, value]) => `${key}: ${value}`).join('; ')} · Self-asserted, not verified. Contact and attestation links are not collected or followed.</p>}
    <p className="muted small">Contribution sends only bounded lifetime session/containment totals and fixed framework counts, with no hostnames, URLs, timestamps or identifiers. Your endpoint still sees network metadata such as your IP address. This is not guaranteed anonymous. No automatic retry or upload queue.</p>
    <button className="button button-outline" disabled={busy || !config.contributionsEnabled || !dashboard.statistics} onClick={() => { if (window.confirm(`Send the displayed browser aggregate totals to ${config.contributionEndpoint}? No hostnames, page data or unique identifiers are included; the server can still observe your IP address.`)) void run(async () => { await send({ type: 'CONTRIBUTE_STATISTICS', consent: true }); setMessage('The configured server confirmed receipt of the aggregate contribution.'); }); }}>Send aggregate contribution once</button>
  </section>;
}
