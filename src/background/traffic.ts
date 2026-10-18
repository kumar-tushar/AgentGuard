import type { ObservationLease, TrafficRecord, TrafficView } from '../shared/traffic';
import { domainFromUrl } from '../shared/domains';
import { observationOwners } from './debugger-ownership';

export interface TrafficPort {
  attach(tabId: number): Promise<void>;
  command(tabId: number, method: 'Network.enable' | 'Page.enable'): Promise<unknown>;
  detach(tabId: number): Promise<void>;
  writeOwners?(ids: number[]): Promise<void>;
}
const unavailable = 'Observation unavailable: Chrome policy, another debugger, a restricted target or attach failure. This is reduced coverage, not evidence of a human-controlled tab.';
/** Explicit, short-lived tab-wide observation. Never asks CDP for bodies, cookies or headers. */
export class TrafficObserver {
  private leases = new Map<number, ObservationLease>();
  private records: TrafficRecord[] = [];
  private queues = new Map<number, Promise<unknown>>();
  constructor(private readonly port: TrafficPort, private readonly now = Date.now) {}
  private serialize<T>(id: number, work: () => Promise<T>): Promise<T> {
    const operation = (this.queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queues.set(id, operation);
    void operation.finally(() => { if (this.queues.get(id) === operation) this.queues.delete(id); }).catch(() => undefined);
    return operation;
  }
  start(tabId: number): Promise<void> {
    return this.serialize(tabId, async () => {
      if (this.leases.get(tabId)?.state === 'observing') return;
      if (this.leases.size >= 20 && !this.leases.has(tabId)) throw new Error('Maximum 20 observation leases');
      if (observationOwners.has(tabId)) await this.stopInner(tabId);
      const lease: ObservationLease = { tabId, state: 'starting', expiresAt: this.now() + 15 * 60_000, reason: 'Explicit tab-wide observation requested.' };
      this.leases.set(tabId, lease); observationOwners.add(tabId);
      let attached = false;
      try {
        // Journal before attaching: a forced worker termination must not make
        // our surviving debugger look like a newly discovered external agent.
        await this.port.writeOwners?.([...observationOwners]);
        await this.port.attach(tabId);
        attached = true;
        // No Runtime/DOM/Fetch body commands or response-body retrieval.
        await this.port.command(tabId, 'Network.enable');
        await this.port.command(tabId, 'Page.enable');
        lease.state = 'observing'; lease.reason = 'Tab-wide metadata only; controller and human initiators remain unknown. Child targets and workers may be missed.';
      } catch {
        lease.state = 'unavailable'; lease.reason = unavailable;
        if (!attached) observationOwners.delete(tabId);
        else try { await this.port.detach(tabId); observationOwners.delete(tabId); } catch { /* Retain ownership uncertainty until detach is confirmed. */ }
        await this.port.writeOwners?.([...observationOwners]);
      }
    });
  }
  private async stopInner(id: number): Promise<void> {
    if (observationOwners.has(id)) {
      try { await this.port.detach(id); observationOwners.delete(id); }
      catch { this.leases.set(id, { tabId: id, state: 'unavailable', expiresAt: this.now(), reason: 'Detach could not be confirmed. Reload AgentGuard to end its debugging session.' }); return; }
    }
    this.leases.delete(id);
    await this.port.writeOwners?.([...observationOwners]);
  }
  stop(id: number): Promise<void> { return this.serialize(id, () => this.stopInner(id)); }
  async stopAll(): Promise<void> { await Promise.all([...this.leases.keys()].map(id => this.stop(id))); }
  async restoreOwners(raw: unknown, liveTabs: ReadonlySet<number>): Promise<void> {
    if (raw === undefined) return;
    if (!Array.isArray(raw) || raw.length > 20 || raw.some(id => !Number.isSafeInteger(id) || id < 0 || id > 2_147_483_647) || new Set(raw).size !== raw.length) throw new Error('Invalid observation ownership journal');
    for (const id of raw as number[]) if (liveTabs.has(id)) {
      observationOwners.add(id);
      this.leases.set(id, { tabId: id, state: 'unavailable', expiresAt: this.now(), reason: 'Previous observation requires debugger cleanup after worker restart.' });
    }
    await this.stopAll();
    await this.port.writeOwners?.([...observationOwners]);
  }
  detached(id: number): void {
    observationOwners.delete(id);
    const lease = this.leases.get(id);
    if (lease) { lease.state = 'unavailable'; lease.reason = unavailable; }
  }
  async expire(): Promise<void> {
    await Promise.all([...this.leases.values()].filter(lease => lease.expiresAt <= this.now()).map(lease => this.stop(lease.tabId)));
  }
  event(tabId: number, method: string, raw: unknown): void {
    const lease = this.leases.get(tabId);
    if (lease?.state !== 'observing' || lease.expiresAt <= this.now() || !raw || typeof raw !== 'object') return;
    const data = raw as Record<string, unknown>;
    let url: unknown, verb: unknown = 'OTHER', status: number | null = null, kind: TrafficRecord['kind'];
    if (method === 'Network.requestWillBeSent') {
      const request = data.request as Record<string, unknown> | undefined;
      url = request?.url; verb = request?.method; kind = 'request';
    } else if (method === 'Network.responseReceived') {
      const response = data.response as Record<string, unknown> | undefined;
      url = response?.url; const code = response?.status;
      if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) status = code;
      kind = 'response';
    } else if (method === 'Page.downloadWillBegin') { url = data.url; kind = 'download_started'; }
    else return;
    const domain = typeof url === 'string' && url.length <= 8192 ? domainFromUrl(url) : null;
    if (!domain) return;
    const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    this.records.push({ id: crypto.randomUUID(), timestamp: this.now(), tabId, domain, kind,
      method: typeof verb === 'string' && allowed.includes(verb) ? verb as TrafficRecord['method'] : 'OTHER', status, initiator: 'unknown' });
    this.records = this.records.slice(-500);
  }
  clear(): void { this.records = []; }
  snapshot(): TrafficView {
    return structuredClone({ leases: [...this.leases.values()].map(lease => lease.state === 'observing' && lease.expiresAt <= this.now()
      ? { ...lease, state: 'unavailable' as const, reason: 'Observation lease expired. Metadata collection stopped; debugger detach is pending browser scheduling.' } : lease), records: this.records });
  }
}
