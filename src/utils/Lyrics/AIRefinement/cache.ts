import { AI_CHUNK_PLAN_VERSION, AI_REFINEMENT_SCHEMA, type RefinementCache, type RefinementRecord } from "./types.ts";

const MAX_RECORDS = 200;
const MAX_BYTES = 16 * 1024 * 1024;

export function refinementRecordKey(trackUri: string, configId: string, docDigest: string): string {
  return `${trackUri}|${AI_REFINEMENT_SCHEMA}|${configId}|${docDigest}|${AI_CHUNK_PLAN_VERSION}`;
}

export function measureRecordBytes(record: RefinementRecord): number {
  return new TextEncoder().encode(JSON.stringify({ ...record, bytes: 0 })).byteLength;
}

export class MemoryRefinementCache implements RefinementCache {
  private records = new Map<string, RefinementRecord>();
  private pinned = new Set<string>();
  public failWrites = false;

  async get(key: string): Promise<RefinementRecord | undefined> {
    const record = this.records.get(key);
    if (!record) return undefined;
    record.lastAccessedAt = Date.now();
    return structuredClone(record);
  }

  async put(record: RefinementRecord): Promise<void> {
    if (this.failWrites) throw new Error("simulated cache write failure");
    const copy = structuredClone(record);
    copy.bytes = measureRecordBytes(copy);
    this.records.set(copy.key, copy);
    this.evict();
  }

  async delete(key: string): Promise<void> { this.records.delete(key); }
  async deleteTrack(trackUri: string): Promise<void> {
    for (const [key, record] of this.records) if (record.trackUri === trackUri) this.records.delete(key);
  }
  async clear(): Promise<void> { this.records.clear(); }
  async listByTrackConfig(trackUri: string, configId: string): Promise<RefinementRecord[]> {
    return Array.from(this.records.values()).filter((record) => record.trackUri === trackUri && record.configId === configId).map((record) => structuredClone(record));
  }
  pin(key: string): void { this.pinned.add(key); }
  unpin(key: string): void { this.pinned.delete(key); this.evict(); }
  snapshot(): RefinementRecord[] { return Array.from(this.records.values()).map((record) => structuredClone(record)); }

  private evict(): void {
    let records = Array.from(this.records.values());
    let bytes = records.reduce((sum, record) => sum + record.bytes, 0);
    while (records.length > MAX_RECORDS || bytes > MAX_BYTES) {
      const victim = records.filter((record) => !this.pinned.has(record.key)).sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.key.localeCompare(b.key))[0];
      if (!victim) return;
      this.records.delete(victim.key);
      bytes -= victim.bytes;
      records = records.filter((record) => record.key !== victim.key);
    }
  }
}

export function sumBudgetConsumed(records: ReadonlyArray<RefinementRecord>): number {
  return records.reduce((sum, record) => sum + record.budgetConsumed, 0);
}
