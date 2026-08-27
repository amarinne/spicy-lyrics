import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSpotifyTokenProvider,
  SpotifyTokenAcquisitionError,
} from "../src/components/Global/SpotifyTokenProvider.ts";

const NOW = 1_000_000;
const freshExpiry = NOW + 120_000;

test("valid AuthorizationAPI state wins", async () => {
  let cosmosReads = 0;
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: {
      readAuthorizationApiState: () => ({ token: { accessToken: "modern", accessTokenExpirationTimestampMs: freshExpiry } }),
      readLegacyCosmosToken: () => { cosmosReads += 1; return { accessToken: "legacy" }; },
    },
  });
  assert.equal(await provider.getToken(), "modern");
  assert.equal(cosmosReads, 0);
});

test("unauthorized and anonymous states fall back", async () => {
  for (const state of [
    { isAuthorized: false, token: { accessToken: "blocked", accessTokenExpirationTimestampMs: freshExpiry } },
    { isAuthorized: true, token: { accessToken: "anonymous", accessTokenExpirationTimestampMs: freshExpiry, isAnonymous: true } },
  ]) {
    const provider = createSpotifyTokenProvider({
      now: () => NOW,
      sources: { readAuthorizationApiState: () => state, readLegacyCosmosToken: () => ({ accessToken: "fallback" }) },
    });
    assert.equal(await provider.getToken(), "fallback");
  }
});

test("expired AuthorizationAPI state falls back", async () => {
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: {
      readAuthorizationApiState: () => ({ isAuthorized: true, token: { accessToken: "old", accessTokenExpirationTimestampMs: NOW + 30_000 } }),
      readLegacyCosmosToken: () => ({ accessToken: "fallback" }),
    },
  });
  assert.equal(await provider.getToken(), "fallback");
});

test("legacy Cosmos success works", async () => {
  const provider = createSpotifyTokenProvider({ now: () => NOW, sources: { readLegacyCosmosToken: () => ({ accessToken: "legacy" }) } });
  assert.equal(await provider.getToken(), "legacy");
});

test("Session fallback works", async () => {
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readLegacyCosmosToken: () => { throw new Error("missing resolver"); }, readSessionTokenState: () => ({ accessToken: "session" }) },
  });
  assert.equal(await provider.getToken(), "session");
});

test("concurrent callers share one refresh", async () => {
  let resolveRead!: (value: { accessToken: string }) => void;
  const readResult = new Promise<{ accessToken: string }>((resolve) => { resolveRead = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let reads = 0;
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readLegacyCosmosToken: () => { reads += 1; markStarted(); return readResult; } },
  });
  const first = provider.getToken();
  const second = provider.getToken();
  await started;
  resolveRead({ accessToken: "shared" });
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  assert.equal(reads, 1);
});

test("one rejected refresh does not poison later calls", async () => {
  let available = false;
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readLegacyCosmosToken: () => available ? { accessToken: "recovered" } : undefined },
  });
  await assert.rejects(provider.getToken(), SpotifyTokenAcquisitionError);
  available = true;
  assert.equal(await provider.getToken(), "recovered");
});

test("invalidation forces a new source read", async () => {
  let reads = 0;
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readLegacyCosmosToken: () => ({ accessToken: `token-${++reads}` }) },
  });
  assert.equal(await provider.getToken(), "token-1");
  assert.equal(await provider.getToken(), "token-1");
  provider.invalidate();
  assert.equal(await provider.getToken(), "token-2");
  assert.equal(reads, 2);
});
