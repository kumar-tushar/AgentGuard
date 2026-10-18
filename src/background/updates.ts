import type { PendingUpdate } from '../shared/updates';
/** Reload never silently interrupts active grants, containment or emergency state. */
export class UpdateController {
  private pending: PendingUpdate | null = null;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly port: {
    read(): Promise<unknown>;
    write(value: PendingUpdate | null): Promise<void>;
    busy(): boolean;
    reload(): void;
  }, private readonly now = Date.now) {}
  async load(): Promise<void> {
    const raw = await this.port.read() as PendingUpdate | null | undefined;
    if (raw === undefined || raw === null) return;
    if (!/^\d{1,5}(?:\.\d{1,5}){1,3}$/u.test(raw.version) || !Number.isSafeInteger(raw.stagedAt) || raw.stagedAt < 0 || raw.stagedAt > this.now()) throw new Error('Invalid pending update');
    this.pending = { version: raw.version, stagedAt: raw.stagedAt };
  }
  async stage(version: unknown): Promise<void> {
    if (typeof version !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){1,3}$/u.test(version)) throw new Error('Invalid update version');
    const operation = this.queue.then(async () => {
      const next = { version, stagedAt: this.now() };
      await this.port.write(next); this.pending = next;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation.then(() => this.apply(false)).then(() => undefined);
  }
  apply(explicit = false): Promise<boolean> {
    const operation = this.queue.then(async () => {
      if (!this.pending || (!explicit && this.port.busy())) return false;
      await this.port.write(null); this.pending = null;
      this.port.reload(); return true;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  snapshot(): PendingUpdate | null { return this.pending ? { ...this.pending } : null; }
}
