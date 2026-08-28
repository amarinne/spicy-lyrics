/**
 * Build-time stub for japanese-lyrics-processor's embedded dictionary modules.
 *
 * Those modules hold ~66MB of base64-encoded gzipped UniDic and JMdict data.
 * The package loads them through a dynamic import so a code-splitting bundler
 * would keep them out of the entry chunk, but spicetify-creator emits a
 * single-file IIFE with no splitting, so esbuild inlines them regardless of
 * whether they are ever called.
 *
 * The desktop fork fetches those dictionaries at runtime and caches them in
 * IndexedDB instead (see src/utils/Lyrics/Processing/Japanese/AssetCache.ts),
 * so the embedded copies are dead weight. spice.config.ts resolves both
 * generated modules here to keep them out of the bundle.
 *
 * These exports exist only so the dynamic import still resolves to a valid
 * module namespace. Reaching any of them means the remote asset source was not
 * configured, so they throw rather than fail later with a confusing decode error.
 */

const unreachable = (name) => {
  throw new Error(
    `[spicy-lyrics] Embedded Japanese dictionary "${name}" was stubbed out of this build. ` +
      `The runtime asset source must be configured; see AssetCache.ts.`
  );
};

export const embeddedUniDicAssets = new Proxy(
  {},
  {
    get: (_target, property) => unreachable(String(property)),
  }
);

export const embeddedJmdictFuriganaGzip = undefined;
export const embeddedJmdictPreferredReadingsGzip = undefined;
