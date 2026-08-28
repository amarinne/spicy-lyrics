import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldRefetchAfterApply } from "../src/utils/Lyrics/PostApplyRefetch.ts";

const URI = "spotify:track:abc";

test("post-apply guard handles sentinel URIs without splitting colons", () => {
  assert.equal(shouldRefetchAfterApply(`NO_LYRICS:${URI}`, URI), false);
  assert.equal(shouldRefetchAfterApply("NO_LYRICS:spotify:track:other", URI), true);
});

test("post-apply guard accepts matching valid JSON", () => {
  assert.equal(shouldRefetchAfterApply(JSON.stringify({ uri: URI }), URI), false);
});

test("post-apply guard refetches differing valid JSON", () => {
  assert.equal(shouldRefetchAfterApply(JSON.stringify({ uri: "spotify:track:other" }), URI), true);
});

test("post-apply guard recovers malformed JSON", () => {
  assert.equal(shouldRefetchAfterApply("{bad", URI), true);
});

test("post-apply guard ignores empty state", () => {
  assert.equal(shouldRefetchAfterApply("", URI), false);
  assert.equal(shouldRefetchAfterApply(null, URI), false);
});

test("post-apply guard ignores missing current URI", () => {
  assert.equal(shouldRefetchAfterApply(JSON.stringify({ uri: URI }), ""), false);
});
