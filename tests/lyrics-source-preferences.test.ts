import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveLyricsSourceConfig, lyricsSourceCacheSignature, normalizeLyricsSourceOrder, resolveLyricsSourceLabel } from "../src/utils/Lyrics/LyricsSourcePreferences.ts";
import { getTrackSourceOverride, parseLyricsSourceOverrides, serializeLyricsSourceOverrides, setTrackSourceOverride } from "../src/utils/Lyrics/LyricsSourceOverrides.ts";
import { isLyricsSourceCacheCompatible } from "../src/utils/Lyrics/LyricsSourceCache.ts";

test("source order normalization rejects unknown values, removes duplicates, and restores omitted providers", () => {
  assert.deepEqual(normalizeLyricsSourceOrder('["spotify","spotify","bad"]'), ["spotify", "spicy", "lrclib"]);
  assert.deepEqual(normalizeLyricsSourceOrder("malformed"), ["spicy", "spotify", "lrclib"]);
});

test("manual source override creates strict single-provider selection and distinct cache identity", () => {
  const automatic = effectiveLyricsSourceConfig('["spicy","spotify","lrclib"]', "smart", "auto");
  const spotify = effectiveLyricsSourceConfig('["spicy","spotify","lrclib"]', "smart", "spotify");
  assert.deepEqual(spotify, { order: ["spotify"], mode: "strict", override: "spotify" });
  assert.notEqual(lyricsSourceCacheSignature(automatic), lyricsSourceCacheSignature(spotify));
});

test("source labels preserve backend provenance", () => {
  assert.equal(resolveLyricsSourceLabel("aml", undefined, "spicy"), "Apple Music");
  assert.equal(resolveLyricsSourceLabel("spt"), "Spotify");
  assert.equal(resolveLyricsSourceLabel(undefined, "Community mirror", "lrclib"), "Community mirror");
});

test("track overrides recover from malformed JSON and support set, replace, and Auto removal", () => {
  const uri = "spotify:track:abc";
  assert.deepEqual(parseLyricsSourceOverrides("not-json"), {});
  let map = setTrackSourceOverride({}, uri, "spotify");
  assert.equal(getTrackSourceOverride(map, uri), "spotify");
  map = setTrackSourceOverride(map, uri, "lrclib");
  assert.equal(getTrackSourceOverride(serializeLyricsSourceOverrides(map), uri), "lrclib");
  map = setTrackSourceOverride(map, uri, "auto");
  assert.equal(getTrackSourceOverride(map, uri), "auto");
});

test("source cache requires exact remote signature while preserving local documents", () => {
  assert.equal(isLyricsSourceCacheCompatible({ source: "spl", fetchProvider: "spicy", LyricsSourceCacheSignature: "v1" }, "v1"), true);
  assert.equal(isLyricsSourceCacheCompatible({ source: "spl", fetchProvider: "spicy", LyricsSourceCacheSignature: "old" }, "v1"), false);
  assert.equal(isLyricsSourceCacheCompatible({ source: "spl" }, "v1"), false);
  assert.equal(isLyricsSourceCacheCompatible({ source: "ldb" }, "v1"), true);
});
