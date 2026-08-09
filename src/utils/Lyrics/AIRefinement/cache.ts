import { AI_CHUNK_PLAN_VERSION, AI_REFINEMENT_SCHEMA, type RefinementCache, type RefinementRecord, type RefinementSchema } from "./types.ts";

export function refinementRecordKey(trackUri: string, configId: string, docDigest: string, schema: RefinementSchema = AI_REFINEMENT_SCHEMA): string {
  return `${trackUri}|${schema}|${configId}|${docDigest}|${AI_CHUNK_PLAN_VERSION}`;
}

export function measureRecordBytes(record: RefinementRecord): number {
  return new TextEncoder().encode(JSON.stringify({ ...record, bytes: 0 })).byteLength;
}

export class MemoryRefinementCache implements RefinementCache {
  private records = new Map<string, RefinementRecord>();
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
  }

  async delete(key: string): Promise<void> { this.records.delete(key); }
  async deleteTrack(trackUri: string): Promise<void> {
    for (const [key, record] of this.records) if (record.trackUri === trackUri) this.records.delete(key);
  }
  async clear(): Promise<void> { this.records.clear(); }
  async listByTrackConfig(trackUri: string, configId: string): Promise<RefinementRecord[]> {
    return Array.from(this.records.values()).filter((record) => record.trackUri === trackUri && record.configId === configId).map((record) => structuredClone(record));
  }
  async listByTrack(trackUri: string): Promise<RefinementRecord[]> {
    return Array.from(this.records.values()).filter((record) => record.trackUri === trackUri).map((record) => structuredClone(record));
  }
  pin(_key: string): void {}
  unpin(_key: string): void {}
  snapshot(): RefinementRecord[] { return Array.from(this.records.values()).map((record) => structuredClone(record)); }
}

export function sumBudgetConsumed(records: ReadonlyArray<RefinementRecord>): number {
  return records.reduce((sum, record) => sum + record.budgetConsumed, 0);
}
