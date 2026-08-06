/**
 * Runtime source for the Japanese dictionaries.
 *
 * japanese-lyrics-processor can embed UniDic and JMdict as base64 gzip blobs,
 * but that costs ~66MB in a build with no code splitting — the whole extension
 * was 75MB because of it. Instead the fork fetches the gzipped assets once and
 * keeps the bytes in IndexedDB, so only the first Japanese track pays for the
 * download and the bundle stays under 10MB.
 *
 * @fork-feature Remote Japanese dictionary assets
 */

import { dbPromise, ensurePersistence, ObjectStores } from "../../../db.ts";
import Logger from "../../../Logger.ts";

const assetLogger = new Logger("JapaneseAssets");

/**
 * Bump when the published assets change. It is part of every cache key, so a
 * new version leaves stale entries unread rather than serving mismatched
 * dictionary files.
 */
export const JAPANESE_ASSET_VERSION = "unidic-3.1.0-jmdict-2026-07";

const DEFAULT_ASSET_BASE_URL =
  "https://github.com/amarinne/spicy-lyrics/releases/download/japanese-assets-v1/";

/**
 * Overridable so a local static server can be used while developing:
 * `window.__SpicyJapaneseAssetBase__ = "http://127.0.0.1:8787/"`.
 */
function assetBaseUrl(): string {
  const override = (globalThis as Record<string, any>).__SpicyJapaneseAssetBase__;
  const base = typeof override === "string" && override ? override : DEFAULT_ASSET_BASE_URL;
  return base.replace(/\/?$/u, "/");
}

const cacheKey = (path: string): string => `${JAPANESE_ASSET_VERSION}/${path}`;

let persistenceRequested = false;

async function readCached(path: string): Promise<Uint8Array | undefined> {
  try {
    const db = await dbPromise;
    const stored = await db.get(ObjectStores.JapaneseAssets, cacheKey(path));
    if (stored instanceof Uint8Array) return stored;
    if (stored instanceof ArrayBuffer) return new Uint8Array(stored);
    return undefined;
  } catch (error) {
    assetLogger.warn("Cache read failed for", path, error);
    return undefined;
  }
}

async function writeCached(path: string, bytes: Uint8Array): Promise<void> {
  try {
    if (!persistenceRequested) {
      persistenceRequested = true;
      // A full dictionary set is ~50MB; without persistence the browser may
      // evict it and force a re-download on the next track.
      await ensurePersistence();
    }
    const db = await dbPromise;
    await db.put(ObjectStores.JapaneseAssets, bytes, cacheKey(path));
  } catch (error) {
    // A cache write failure only costs a re-download, so it must not break playback.
    assetLogger.warn("Cache write failed for", path, error);
  }
}

async function fetchAsset(path: string): Promise<Uint8Array> {
  const url = `${assetBaseUrl()}${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Japanese asset ${path}: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`Japanese asset ${path}: empty response`);
  return bytes;
}

/** In-flight requests, so concurrent loaders share one download per asset. */
const inFlight = new Map<string, Promise<Uint8Array>>();

async function loadAsset(path: string): Promise<Uint8Array> {
  const cached = await readCached(path);
  if (cached) return cached;

  const existing = inFlight.get(path);
  if (existing) return existing;

  const request = (async () => {
    assetLogger.debug("Fetching", path);
    const bytes = await fetchAsset(path);
    await writeCached(path, bytes);
    return bytes;
  })().finally(() => inFlight.delete(path));

  inFlight.set(path, request);
  return request;
}

/**
 * Builds the `loadAsset` hook japanese-lyrics-processor calls with a bare
 * filename, mapping it into the published asset layout.
 *
 * The names are flat rather than nested because GitHub release assets have no
 * directories — `unidic/base.dat.gz` would 404 — so a namespace becomes a
 * filename prefix instead: `unidic` + `base.dat.gz` -> `unidic-base.dat.gz`.
 */
export function japaneseAssetLoader(namespace = ""): (name: string) => Promise<Uint8Array> {
  const prefix = namespace ? `${namespace}-` : "";
  return (name: string) => loadAsset(`${prefix}${name}`);
}

/** Drops every cached dictionary, including entries from older asset versions. */
export async function clearJapaneseAssetCache(): Promise<void> {
  const db = await dbPromise;
  await db.clear(ObjectStores.JapaneseAssets);
  assetLogger.debug("Cleared cached Japanese dictionary assets");
}
