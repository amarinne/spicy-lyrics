import assert from "node:assert/strict";
import { test } from "node:test";
import { GetExpireStore } from "../src/modules/Store.ts";

class MemoryCache {
  private entries = new Map<string, Response>();
  async match(key: string): Promise<Response | undefined> { return this.entries.get(key)?.clone(); }
  async put(key: string, response: Response): Promise<void> { this.entries.set(key, response.clone()); }
  async delete(key: string): Promise<boolean> { return this.entries.delete(key); }
}

const stores = new Map<string, MemoryCache>();
Object.defineProperty(globalThis, "caches", {
  configurable: true,
  value: {
    open: async (name: string) => {
      let cache = stores.get(name);
      if (!cache) { cache = new MemoryCache(); stores.set(name, cache); }
      return cache;
    },
    delete: async (name: string) => stores.delete(name),
  },
});

async function seed(name: string, item: string, envelope: unknown): Promise<void> {
  const cache = await (globalThis as any).caches.open(name);
  await cache.put(`/${item}`, new Response(JSON.stringify(envelope), { headers: { "Content-Type": "application/json" } }));
}

test("persistent stores read legacy expired entries and write non-expiring entries", async () => {
  const name = "test-persistent-store";
  await seed(name, "song", { ExpiresAt: 1, CacheVersion: 2, Content: { text: "cached" } });
  const store = GetExpireStore<{ text: string }>(name, 2);
  assert.deepEqual(await store.GetItem("song"), { text: "cached" });
  await store.SetItem("new-song", { text: "new" });
  const response = await (await (globalThis as any).caches.open(name)).match("/new-song");
  assert.equal((await response.json()).ExpiresAt, Number.MAX_SAFE_INTEGER);
});

test("expiring stores still reject expired entries", async () => {
  const name = "test-expiring-store";
  await seed(name, "song", { ExpiresAt: 1, CacheVersion: 2, Content: { text: "cached" } });
  const store = GetExpireStore<{ text: string }>(name, 2, { Unit: "Days", Duration: 3 });
  assert.equal(await store.GetItem("song"), undefined);
});

test("persistent stores still reject incompatible cache schema versions", async () => {
  const name = "test-versioned-persistent-store";
  await seed(name, "song", { ExpiresAt: Number.MAX_SAFE_INTEGER, CacheVersion: 1, Content: { text: "cached" } });
  const store = GetExpireStore<{ text: string }>(name, 2);
  assert.equal(await store.GetItem("song"), undefined);
});
