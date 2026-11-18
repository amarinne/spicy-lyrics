import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHINESE_DETECTION_LOG_KEY, recordChineseAudio, recordChineseDetection,
} from "../src/utils/Lyrics/ChineseDetectionLog.ts";

function harness() {
  const store = new Map<string, string>();
  const messages: string[] = [];
  (globalThis as any).Spicetify = {
    LocalStorage: { get: (key: string) => store.get(key) ?? null, set: (key: string, value: string) => store.set(key, value) },
    Player: { data: { item: { name: "花海", artists: [{ name: "周杰倫" }] } } },
  };
  const original = console.info;
  console.info = (message?: unknown) => messages.push(String(message));
  return {
    messages,
    read: () => JSON.parse(store.get(CHINESE_DETECTION_LOG_KEY)!),
    restore: () => { console.info = original; },
  };
}

test("the decision log attaches audio evidence and flags a text/audio disagreement", () => {
  const h = harness();
  try {
    const uri = "spotify:track:" + "a".repeat(22);
    recordChineseDetection({
      uri, mode: "auto", lines: 28, z: -2.1, toneExcess: 0.08, markers: 0, p: 0.09, textLanguage: "cmn",
    });
    recordChineseAudio(uri, { audioLid: -7, audioFit: 0.05, audioLanguage: "yue" }, "auto");
    const log = h.read();
    assert.equal(log.length, 1);
    assert.equal(log[0].title, "花海");
    assert.equal(log[0].artist, "周杰倫");
    assert.equal(log[0].textLanguage, "cmn");
    assert.equal(log[0].audioLanguage, "yue");
    assert.equal(log[0].audioLid, -7);
    assert.equal(log[0].audioFit, 0.05);
    assert.equal(h.messages.length, 3);
    assert.match(h.messages[0], /chinese-detect \{/);
    assert.match(h.messages[1], /chinese-detect \{/);
    assert.match(h.messages[2], /chinese-detect-disagreement/);
    for (const forbidden of ["audio", "transcript", "lyrics"]) assert.equal(forbidden in log[0], false);
  } finally {
    h.restore();
  }
});

test("an audio decision from a cached document still produces a reportable record", () => {
  const h = harness();
  try {
    const uri = "spotify:track:" + "b".repeat(22);
    recordChineseAudio(uri, { audioLid: -6, audioFit: 0.04, audioLanguage: "yue" }, "auto-vn");
    const log = h.read();
    assert.equal(log.length, 1);
    assert.equal(log[0].mode, "auto-vn");
    assert.equal(log[0].lines, 0);
    assert.equal(log[0].audioFit, 0.04);
    assert.equal(log[0].textLanguage, undefined);
    assert.equal(h.messages.length, 1);
  } finally {
    h.restore();
  }
});
