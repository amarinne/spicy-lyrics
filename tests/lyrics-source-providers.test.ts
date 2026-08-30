import assert from "node:assert/strict";
import { test } from "node:test";

(globalThis as any).window = {};
(globalThis as any).Spicetify = {
  LocalStorage: { get: () => null, set: () => undefined },
  Player: { data: { item: null } },
  CosmosAsync: { get: async () => ({}) },
};

const sources = await import("../src/utils/Lyrics/LyricsSourceDocuments.ts");
const info = { uri: "spotify:track:test", id: "test", title: "Song", artists: ["Artist"], album: "Album", durationMs: 180_000 };

test("ID-only providers remain usable while LRCLIB waits for complete metadata", () => {
  assert.equal(sources.canQueryLrclib({ ...info, title: "", artists: [], durationMs: 0 }), false);
  assert.equal(sources.canQueryLrclib(info), true);
});

test("Spotify synced and unsynced responses normalize with provenance", () => {
  const synced = sources.normalizeSpotifyLyrics({ lyrics: { syncType: "LINE_SYNCED", lines: [{ words: "Hello", startTimeMs: "1000" }, { words: "World", startTimeMs: "3000" }] } }, info)!;
  assert.equal(synced.lyrics.Type, "Line");
  assert.equal(synced.lyrics.Content[0].StartTime, 1);
  assert.equal(synced.lyrics.fetchProvider, "spotify");
  assert.equal(synced.lyrics.sourceDisplayName, "Spotify");

  const plain = sources.normalizeSpotifyLyrics({ lyrics: { syncType: "UNSYNCED", lines: [{ words: "Hello" }, { words: "World" }] } }, info)!;
  assert.equal(plain.lyrics.Type, "Static");
  assert.deepEqual(plain.lyrics.Lines.map((line: any) => line.Text), ["Hello", "World"]);
});

test("source timing faults are rejected before normalization can sort or clamp them", () => {
  for (const lines of [
    [{ words: "Negative", startTimeMs: -1 }, { words: "Next", startTimeMs: 1000 }],
    [{ words: "Later", startTimeMs: 3000 }, { words: "Earlier", startTimeMs: 1000 }],
    [{ words: "Duplicate", startTimeMs: 1000 }, { words: "Duplicate 2", startTimeMs: 1000 }],
    [{ words: "Beyond duration", startTimeMs: info.durationMs + 16_000 }],
  ]) assert.equal(sources.normalizeSpotifyLyrics({ lyrics: { syncType: "LINE_SYNCED", lines } }, info), null);
  assert.equal(sources.normalizeLrclibLyrics({ syncedLyrics: "[offset:-2000]\n[00:01.00]Negative", trackName: "Song", artistName: "Artist", duration: 180 }, info), null);
  assert.equal(sources.normalizeLrclibLyrics({ syncedLyrics: "[00:03.00]Later\n[00:01.00]Earlier", trackName: "Song", artistName: "Artist", duration: 180 }, info), null);
});

test("LRCLIB synced, plain, and instrumental responses normalize", () => {
  const synced = sources.normalizeLrclibLyrics({ syncedLyrics: "[00:01.00]Hello\n[00:03.50]World", trackName: "Song", artistName: "Artist", duration: 180 }, info)!;
  assert.equal(synced.lyrics.Type, "Line");
  assert.equal(synced.lyrics.Content[1].StartTime, 3.5);
  assert.equal(synced.lyrics.fetchProvider, "lrclib");

  const plain = sources.normalizeLrclibLyrics({ plainLyrics: "Hello\nWorld", trackName: "Song", artistName: "Artist", duration: 180 }, info)!;
  assert.equal(plain.lyrics.Type, "Static");
  const instrumental = sources.normalizeLrclibLyrics({ instrumental: true, trackName: "Song", artistName: "Artist", duration: 180 }, info)!;
  assert.equal(instrumental.lyrics.Lines[0].Text, "♪ Instrumental ♪");
  assert.equal(sources.normalizeLrclibLyrics({}, info), null);
});

test("LRCLIB rejects materially mismatched metadata", () => {
  const base = { plainLyrics: "Hello\nWorld", trackName: "Song", artistName: "Artist", duration: 180 };
  assert.equal(sources.normalizeLrclibLyrics({ ...base, trackName: "Completely Different" }, info), null);
  assert.equal(sources.normalizeLrclibLyrics({ ...base, artistName: "Another Performer" }, info), null);
  assert.equal(sources.normalizeLrclibLyrics({ ...base, duration: 240 }, info), null);
  assert.ok(sources.normalizeLrclibLyrics({ ...base, trackName: "Song (Remastered)" }, info));
});

test("Spicy accepts both community and Apple backend documents", () => {
  const community = sources.normalizeSpicyLyrics({ Type: "Static", Lines: [{ Text: "Hello" }], source: "spl" })!;
  const apple = sources.normalizeSpicyLyrics({ Type: "Static", Lines: [{ Text: "Hello" }], source: "aml" })!;
  assert.equal(community.lyrics.fetchProvider, "spicy");
  assert.equal(community.lyrics.sourceDisplayName, "Spicy Lyrics");
  assert.equal(apple.lyrics.fetchProvider, "spicy");
  assert.equal(apple.lyrics.sourceDisplayName, "Apple Music");
});

test("Spicy forced-update control response is rejected as lyrics", () => {
  const control = {
    Type: "Static",
    Lines: [
      { Text: "Please update Spicy Lyrics" },
      { Text: "You can do so immediately by restarting Spotify" },
    ],
    source: "spl",
  };
  assert.equal(sources.isSpicyForcedUpdateControl(control), true);
  assert.equal(sources.normalizeSpicyLyrics(control), null);
  assert.ok(sources.normalizeSpicyLyrics({ ...control, Lines: [{ Text: "Please update Spicy Lyrics" }] }));
});

test("queued Spicy cannot hide a usable Spotify candidate", async () => {
  const result = await sources.acquireLyricsFromSources(info, ["spicy", "spotify", "lrclib"], "smart", {
    spicy: async () => ({ kind: "queued" }),
    spotify: async () => ({ kind: "lyrics", result: sources.normalizeSpotifyLyrics({ lyrics: { syncType: "LINE_SYNCED", lines: [{ words: "One", startTimeMs: 0 }, { words: "Two", startTimeMs: 60_000 }, { words: "Three", startTimeMs: 120_000 }] } }, info)! }),
    lrclib: async () => ({ kind: "no-match" }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.lyrics.fetchProvider, "spotify");
});

test("strict manual acquisition calls only the chosen provider and queued survives without a candidate", async () => {
  const calls: string[] = [];
  const adapters = {
    spicy: async () => { calls.push("spicy"); return { kind: "queued" } as const; },
    spotify: async () => { calls.push("spotify"); return { kind: "no-match" } as const; },
    lrclib: async () => { calls.push("lrclib"); return { kind: "no-match" } as const; },
  };
  const result = await sources.acquireLyricsFromSources(info, ["spicy"], "strict", adapters);
  assert.deepEqual(calls, ["spicy"]);
  assert.equal(result.status, 503);
});
