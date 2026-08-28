import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const spiceConfig = read("spice.config.ts");
const processorSource = read("src/utils/Lyrics/Processing/Japanese/JapanesePackageProcessor.ts");
const assetCacheSource = read("src/utils/Lyrics/Processing/Japanese/AssetCache.ts");

/**
 * japanese-lyrics-processor can embed UniDic and JMdict as base64 gzip blobs.
 * The build is a single-file IIFE with no code splitting, so esbuild inlines
 * them even though they are loaded through a dynamic import — that is what took
 * the extension from 1MB to 75MB. The fork fetches the dictionaries at runtime
 * and caches them in IndexedDB instead. These guards keep that wiring intact.
 */
test("the build stubs the embedded dictionary modules out of the bundle", () => {
  assert.match(spiceConfig, /japanese-assets-stub/u);
  assert.match(spiceConfig, /\(unidic\|jmdict\)-assets\\\.generated/u);
  assert.match(spiceConfig, /plugins:\s*\[stubEmbeddedJapaneseAssets\]/u);
});

test("esbuild asset filter stays free of the unsupported unicode flag", () => {
  // esbuild compiles onResolve filters with Go's regexp engine, which rejects
  // the `u` flag outright and fails the whole build.
  const filter = spiceConfig.match(/filter:\s*(\/.*\/[a-z]*)/u)?.[1];
  assert.ok(filter, "expected an onResolve filter in spice.config.ts");
  assert.doesNotMatch(filter, /\/[a-z]*u[a-z]*$/u, `filter must not carry the u flag: ${filter}`);
});

test("the Japanese processor loads dictionaries through the cache, not the bundle", () => {
  assert.match(processorSource, /import\(["']\.\/AssetCache\.ts["']\)/u);
  assert.match(processorSource, /loadAsset:\s*japaneseAssetLoader\("unidic"\)/u);
  // Node has no IndexedDB, so tests fall back to the real embedded dictionaries.
  assert.match(processorSource, /typeof\s+indexedDB\s*===\s*["']undefined["']/u);
});

test("the asset cache keys entries by asset version", () => {
  assert.match(assetCacheSource, /JAPANESE_ASSET_VERSION/u);
  assert.match(assetCacheSource, /\$\{JAPANESE_ASSET_VERSION\}\//u);
});
