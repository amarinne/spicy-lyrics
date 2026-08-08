import { dbPromise, ObjectStores } from "../../db.ts";
import { measureRecordBytes } from "./cache.ts";
import type { RefinementCache, RefinementRecord } from "./types.ts";

const MAX_RECORDS = 200;
const MAX_BYTES = 16 * 1024 * 1024;

export type RefinementCacheInventoryItem = { key: string; trackUri: string; trackLabel?: string; layer: "meaning" | "sound"; providerId: string; modelName: string; status: RefinementRecord["status"]; tokens: { input: number; output: number }; lastAccessedAt: number; bytes: number };

export async function listRefinementCacheInventory(): Promise<RefinementCacheInventoryItem[]> {
  const records = await (await dbPromise).getAll(ObjectStores.AIRefinements) as RefinementRecord[];
  return records.sort((left, right) => right.lastAccessedAt - left.lastAccessedAt).map(({ key, trackUri, trackLabel, layer, providerId, modelName, status, tokens, lastAccessedAt, bytes }) => ({ key, trackUri, trackLabel, layer: layer ?? "meaning", providerId, modelName, status, tokens, lastAccessedAt, bytes }));
}

export class IndexedDBRefinementCache implements RefinementCache {
  private pinned = new Set<string>();
  async get(key: string): Promise<RefinementRecord | undefined> {
    const db = await dbPromise;
    const record = await db.get(ObjectStores.AIRefinements, key) as RefinementRecord | undefined;
    if (!record) return undefined;
    record.lastAccessedAt = Date.now();
    await db.put(ObjectStores.AIRefinements, record);
    return record;
  }
  async put(record: RefinementRecord): Promise<void> {
    const db = await dbPromise;
    record.bytes = measureRecordBytes(record);
    await db.put(ObjectStores.AIRefinements, record);
    await this.evict();
  }
  async delete(key: string): Promise<void> { await (await dbPromise).delete(ObjectStores.AIRefinements, key); }
  async deleteTrack(trackUri: string): Promise<void> {
    const db = await dbPromise;
    const tx = db.transaction(ObjectStores.AIRefinements, "readwrite");
    let cursor = await tx.store.openCursor();
    while (cursor) { if ((cursor.value as RefinementRecord).trackUri === trackUri) await cursor.delete(); cursor = await cursor.continue(); }
    await tx.done;
  }
  async clear(): Promise<void> { await (await dbPromise).clear(ObjectStores.AIRefinements); }
  async listByTrackConfig(trackUri: string, configId: string): Promise<RefinementRecord[]> {
    const db = await dbPromise;
    return await db.getAllFromIndex(ObjectStores.AIRefinements, "byTrackConfig", [trackUri, configId]) as RefinementRecord[];
  }
  pin(key: string): void { this.pinned.add(key); }
  unpin(key: string): void { this.pinned.delete(key); void this.evict(); }
  private async evict(): Promise<void> {
    const db = await dbPromise;
    const records = await db.getAll(ObjectStores.AIRefinements) as RefinementRecord[];
    let count = records.length;
    let bytes = records.reduce((sum, record) => sum + record.bytes, 0);
    for (const record of records.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.key.localeCompare(b.key))) {
      if (count <= MAX_RECORDS && bytes <= MAX_BYTES) break;
      if (this.pinned.has(record.key)) continue;
      await db.delete(ObjectStores.AIRefinements, record.key);
      count--; bytes -= record.bytes;
    }
  }
}
