// Set before attach, cleared only after detach. Epochs invalidate in-flight
// passive captures even when a complete attach/detach happens during the call.
class OwnershipSet extends Set<number> {
  epoch = 0;
  override add(id: number): this { if (!this.has(id)) this.epoch++; return super.add(id); }
  override delete(id: number): boolean { if (this.has(id)) this.epoch++; return super.delete(id); }
  override clear(): void { if (this.size) this.epoch++; super.clear(); }
}
export const observationOwners = new OwnershipSet();
