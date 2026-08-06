import { openDB } from "idb";
import Logger from "./Logger.ts";

const dbLogger = new Logger("Database");

export const ObjectStores = {
  LyricsStore: "lyricsStore",
  // Gzipped UniDic/JMdict bytes, fetched once instead of bundled. See
  // Lyrics/Processing/Japanese/AssetCache.ts.
  JapaneseAssets: "japaneseAssets",
}

export const dbPromise = openDB("spicylyrics", 2, {
  upgrade(db) {
    dbLogger.debug("Upgrade invoked");
    if (!db.objectStoreNames.contains(ObjectStores.LyricsStore)) {
      db.createObjectStore(ObjectStores.LyricsStore);
      dbLogger.debug("Created '", ObjectStores.LyricsStore, "' store");
    }
    if (!db.objectStoreNames.contains(ObjectStores.JapaneseAssets)) {
      db.createObjectStore(ObjectStores.JapaneseAssets);
      dbLogger.debug("Created '", ObjectStores.JapaneseAssets, "' store");
    }
  },
});

export async function ensurePersistence() {
  try {
    if (await navigator.storage.persisted()) return true;

    const granted = await navigator.storage.persist();
    if (!granted) {
      dbLogger.warn("Data persistence request was denied; This can lead to potential data loss")
    } else {
      dbLogger.debug("Data persistence request was accepted")
    }
    return granted;
  } catch (e) {
    dbLogger.warn("Persistence check failed")
    return false;
  }
}