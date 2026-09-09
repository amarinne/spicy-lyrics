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

test("modern rotation supersedes a still-valid cached token", async () => {
  let token = "first";
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readAuthorizationApiState: () => ({ token: { accessToken: token, accessTokenExpirationTimestampMs: freshExpiry } }) },
  });
  assert.equal(await provider.getToken(), "first");
  token = "rotated";
  assert.equal(await provider.getToken(), "rotated");
});

test("rejected modern and Cosmos tokens fall through to a fresh Session token", async () => {
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: {
      readAuthorizationApiState: () => ({ token: { accessToken: "rejected", accessTokenExpirationTimestampMs: freshExpiry } }),
      readLegacyCosmosToken: () => ({ accessToken: "rejected" }),
      readSessionTokenState: () => ({ accessToken: "fresh" }),
    },
  });
  assert.equal(await provider.getToken(), "rejected");
  provider.invalidate("rejected");
  assert.equal(await provider.getToken(), "fresh");
});

test("all sources repeating a rejected token fail until rotation", async () => {
  let token = "rejected";
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readLegacyCosmosToken: () => ({ accessToken: token }) },
  });
  assert.equal(await provider.getToken(), token);
  provider.invalidate(token);
  await assert.rejects(provider.getToken(), SpotifyTokenAcquisitionError);
  await assert.rejects(provider.getToken(), SpotifyTokenAcquisitionError);
  token = "rotated";
  assert.equal(await provider.getToken(), token);
});

test("late rejection of an older token preserves the rotated cache", async () => {
  let token = "old";
  const provider = createSpotifyTokenProvider({
    now: () => NOW,
    sources: { readAuthorizationApiState: () => token ? { token: { accessToken: token, accessTokenExpirationTimestampMs: freshExpiry } } : undefined },
  });
  assert.equal(await provider.getToken(), "old");
  token = "new";
  assert.equal(await provider.getToken(), "new");
  provider.invalidate("old");
  token = "";
  assert.equal(await provider.getToken(), "new");
});
