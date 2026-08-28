import { openDB } from "idb";
import Logger from "./Logger.ts";

const dbLogger = new Logger("Database");

export const ObjectStores = {
  LyricsStore: "lyricsStore",
  // Gzipped UniDic/JMdict bytes, fetched once instead of bundled. See
  // Lyrics/Processing/Japanese/AssetCache.ts.
  JapaneseAssets: "japaneseAssets",
  AIRefinements: "aiRefinements",
  AICredentials: "aiCredentials",
  AICaptures: "aiCaptures",
}

export const dbPromise = openDB("spicylyrics", 5, {
  upgrade(db, _oldVersion, _newVersion, transaction) {
    dbLogger.debug("Upgrade invoked");
    if (!db.objectStoreNames.contains(ObjectStores.LyricsStore)) {
      db.createObjectStore(ObjectStores.LyricsStore);
      dbLogger.debug("Created '", ObjectStores.LyricsStore, "' store");
    }
    if (!db.objectStoreNames.contains(ObjectStores.JapaneseAssets)) {
      db.createObjectStore(ObjectStores.JapaneseAssets);
      dbLogger.debug("Created '", ObjectStores.JapaneseAssets, "' store");
    }
    const refinementStore = db.objectStoreNames.contains(ObjectStores.AIRefinements)
      ? transaction.objectStore(ObjectStores.AIRefinements)
      : db.createObjectStore(ObjectStores.AIRefinements, { keyPath: "key" });
    if (!refinementStore.indexNames.contains("byTrackConfig")) refinementStore.createIndex("byTrackConfig", ["trackUri", "configId"]);
    if (!refinementStore.indexNames.contains("byLastAccessedAt")) refinementStore.createIndex("byLastAccessedAt", "lastAccessedAt");
    if (!refinementStore.indexNames.contains("byTrack")) refinementStore.createIndex("byTrack", "trackUri");
    if (!db.objectStoreNames.contains(ObjectStores.AICredentials)) {
      db.createObjectStore(ObjectStores.AICredentials);
      dbLogger.debug("Created AI credential store");
    }
    if (!db.objectStoreNames.contains(ObjectStores.AICaptures)) {
      const store = db.createObjectStore(ObjectStores.AICaptures, { keyPath: "id" });
      store.createIndex("byUpdatedAt", "updatedAt");
      store.createIndex("byTrackUri", "trackUri");
      dbLogger.debug("Created durable AI capture store and indexes");
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
