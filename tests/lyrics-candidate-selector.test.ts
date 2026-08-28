import assert from "node:assert/strict";
import { test } from "node:test";
import { assessLyricsCandidates, selectLyricsCandidate } from "../src/utils/Lyrics/LyricsCandidateSelector.ts";

const durationMs = 180_000;
const line = (texts: string[], offset = 0) => ({
  Type: "Line",
  Content: texts.map((Text, index) => ({ Text, StartTime: offset + index * 30, EndTime: offset + index * 30 + 10 })),
});
const staticLyrics = (texts: string[]) => ({ Type: "Static", Lines: texts.map((Text) => ({ Text })) });

test("smart ranking is independent of provider response arrival order", () => {
  const candidates = [
    { provider: "spicy", orderIndex: 0, lyrics: line(["one", "two", "three"]), match: { confidence: 1 } },
    { provider: "spotify", orderIndex: 1, lyrics: line(["one", "two", "three"], 0.2), match: { confidence: 1 } },
    { provider: "lrclib", orderIndex: 2, lyrics: staticLyrics(["one", "two", "three"]), match: { confidence: 0.9 } },
  ];
  const forward = selectLyricsCandidate(candidates, durationMs, "smart").candidate?.provider;
  const reverse = selectLyricsCandidate([...candidates].reverse(), durationMs, "smart").candidate?.provider;
  assert.equal(forward, reverse);
  assert.equal(forward, "spicy");
});

test("sync-type mode prefers synchronized detail and source order breaks ties", () => {
  const selection = selectLyricsCandidate([
    { provider: "lrclib", orderIndex: 2, lyrics: staticLyrics(["one", "two", "three"]), match: { confidence: 1 } },
    { provider: "spotify", orderIndex: 1, lyrics: line(["one", "two", "three"]), match: { confidence: 1 } },
    { provider: "spicy", orderIndex: 0, lyrics: line(["one", "two", "three"]), match: { confidence: 1 } },
  ], durationMs, "syncType");
  assert.equal(selection.candidate?.provider, "spicy");
});

test("malformed timing is rejected instead of winning on sync detail", () => {
  const malformed = { Type: "Syllable", Content: [
    { Lead: { StartTime: 20, EndTime: 10, Syllables: [{ Text: "bad", StartTime: 20, EndTime: 10 }] } },
    { Lead: { StartTime: 5, EndTime: 4, Syllables: [{ Text: "timing", StartTime: 5, EndTime: 4 }] } },
  ] };
  const assessments = assessLyricsCandidates([
    { provider: "spicy", orderIndex: 0, lyrics: malformed, match: { confidence: 1 } },
    { provider: "spotify", orderIndex: 1, lyrics: line(["bad", "timing", "usable"]), match: { confidence: 1 } },
  ], durationMs);
  assert.equal(assessments.find((item) => item.provider === "spicy")?.rejected, true);
  assert.equal(selectLyricsCandidate([
    { provider: "spicy", orderIndex: 0, lyrics: malformed, match: { confidence: 1 } },
    { provider: "spotify", orderIndex: 1, lyrics: line(["bad", "timing", "usable"]), match: { confidence: 1 } },
  ], durationMs, "smart").candidate?.provider, "spotify");
});
