import { dbPromise, ObjectStores } from "../../db.ts";
import { measureRecordBytes } from "./cache.ts";
import type { RefinementCache, RefinementRecord } from "./types.ts";

export type RefinementCacheInventoryItem = { key: string; trackUri: string; trackLabel?: string; layer: "meaning" | "sound"; providerId: string; modelName: string; status: RefinementRecord["status"]; tokens: { input: number; output: number }; lastAccessedAt: number; bytes: number };

export async function listRefinementCacheInventory(): Promise<RefinementCacheInventoryItem[]> {
  const records = await (await dbPromise).getAll(ObjectStores.AIRefinements) as RefinementRecord[];
  return records.sort((left, right) => right.lastAccessedAt - left.lastAccessedAt).map(({ key, trackUri, trackLabel, layer, providerId, modelName, status, tokens, lastAccessedAt, bytes }) => ({ key, trackUri, trackLabel, layer: layer ?? "meaning", providerId, modelName, status, tokens, lastAccessedAt, bytes }));
}

async function saveJson(filename: string, contents: string): Promise<string | null> {
  const picker = (window as any).showSaveFilePicker as ((options: unknown) => Promise<any>) | undefined;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: [{ description: "AI lyric document", accept: { "application/json": [".json"] } }] });
      const writable = await handle.createWritable();
      await writable.write(contents); await writable.close();
      return filename;
    } catch (error) {
      if ((error as any)?.name === "AbortError") return null;
      throw error;
    }
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
  return filename;
}

export async function downloadRefinementCacheRecord(key: string): Promise<string | null> {
  const record = await (await dbPromise).get(ObjectStores.AIRefinements, key) as RefinementRecord | undefined;
  if (!record) return null;
  const model = record.modelName.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "model";
  const filename = `spicy-ai-document-${model}-${new Date(record.createdAt).toISOString().replace(/[:.]/g, "-")}.json`;
  return saveJson(filename, JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), record }, null, 2));
}

export class IndexedDBRefinementCache implements RefinementCache {
  private deferTouch(key: string): void {
    queueMicrotask(() => {
      void (async () => {
        const db = await dbPromise;
        const tx = db.transaction(ObjectStores.AIRefinements, "readwrite");
        const latest = await tx.store.get(key) as RefinementRecord | undefined;
        if (latest) { latest.lastAccessedAt = Date.now(); await tx.store.put(latest); }
        await tx.done;
      })().catch(() => undefined);
    });
  }

  async get(key: string): Promise<RefinementRecord | undefined> {
    const db = await dbPromise;
    const record = await db.get(ObjectStores.AIRefinements, key) as RefinementRecord | undefined;
    if (!record) return undefined;
    record.lastAccessedAt = Date.now();
    this.deferTouch(key);
    return record;
  }
  async put(record: RefinementRecord): Promise<void> {
    const db = await dbPromise;
    record.bytes = measureRecordBytes(record);
    await db.put(ObjectStores.AIRefinements, record);
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
  async listByTrack(trackUri: string): Promise<RefinementRecord[]> {
    return await (await dbPromise).getAllFromIndex(ObjectStores.AIRefinements, "byTrack", trackUri) as RefinementRecord[];
  }
  pin(_key: string): void {}
  unpin(_key: string): void {}
}
