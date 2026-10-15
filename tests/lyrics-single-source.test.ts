import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));

test("the fork fetches from the Spicy Lyrics service only, like upstream", () => {
  // Every multi-source module is gone. LyricsSourcePreferences survives only for
  // the credits footer label, which maps the source code the service assigned.
  for (const path of [
    "src/utils/Lyrics/LyricsCandidateSelector.ts",
    "src/utils/Lyrics/LyricsSourceOverrides.ts",
    "src/utils/Lyrics/LyricsSourceCache.ts",
    "src/utils/Lyrics/LrcParser.ts",
    "src/utils/openLyricsSourcePicker.tsx",
  ]) {
    assert.equal(exists(path), false, `${path} should be removed`);
  }

  const sources = read("src/utils/Lyrics/LyricsSources.ts");
  // No second provider, and no LRCLIB/Spotify adapters left behind.
  assert.doesNotMatch(sources, /lrclib|cosmosAsync|color-lyrics/i);
  // The single fetch keeps the fork's bounded auth retry and shared breaker.
  assert.match(sources, /acquireSpicyOutcomeWithBoundedAuthRetry/);
  assert.match(sources, /Platform\.GetSpotifyAccessToken/);
  assert.match(sources, /\{ probe: true \}/);
  assert.match(sources, /ServiceUnavailableError/);

  const fetchLyrics = read("src/utils/Lyrics/fetchLyrics.ts");
  assert.doesNotMatch(fetchLyrics, /sourceConfig|lyricsSourceCacheSignature|SelectionDiagnostics|source-unavailable/);
  assert.match(fetchLyrics, /fetchLyricsFromSpicy/);
});

test("the credits footer is a plain credit line, not a source switch", () => {
  const provider = read("src/utils/Lyrics/Applyer/Credits/ApplyProvider.ts");
  assert.doesNotMatch(provider, /createElement\("button"\)/);
  assert.doesNotMatch(provider, /addEventListener/);
  assert.match(provider, /createElement\("div"\)/);

  // No picker styles or "use Auto source" recovery button survive either.
  const settingsCss = read("src/css/settings-panel.css");
  assert.doesNotMatch(settingsCss, /sl-lyrics-source/);
  assert.doesNotMatch(read("src/css/default.scss"), /source-auto-action/);
});

test("source-selection settings are gone from the stores and page wiring", () => {
  const stores = read("src/utils/stores.ts");
  for (const atom of ["$lyricsSourceOrder", "$lyricsSelectionMode", "$lyricsSourceOverrides", "$lyricsSelectionDiagnostics"]) {
    assert.doesNotMatch(stores, new RegExp(atom.replace(/\$/g, "\\$")));
  }
  assert.doesNotMatch(read("src/components/Pages/PageView.ts"), /lyricsSourceOrder|lyricsSelectionMode/);
});

test("the request-ownership contract survives the source removal", () => {
  // LyricsRequestCoordinator is the fork's own contract, not part of source
  // selection: a stale fetch must never publish over a newer track.
  assert.equal(exists("src/utils/Lyrics/LyricsRequestSession.ts"), true);
  const session = read("src/utils/Lyrics/LyricsRequestSession.ts");
  assert.match(session, /isCurrent/);
  assert.match(session, /invalidate\(\)/);
  const fetchLyrics = read("src/utils/Lyrics/fetchLyrics.ts");
  assert.match(fetchLyrics, /LyricsRequestCoordinator/);
  assert.match(fetchLyrics, /requestIsCurrent/);
});