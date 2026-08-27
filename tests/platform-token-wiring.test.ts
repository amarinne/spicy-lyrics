import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../src/components/Global/Platform.ts", import.meta.url),
  "utf8"
);

test("Platform wires modern and legacy token sources without requiring Cosmos", () => {
  assert.match(source, /authorizationApi\.getState\(\)/u);
  assert.match(source, /SpotifyInternalFetch\?\.get\("sp:\/\/oauth\/v2\/token"\)/u);
  assert.match(source, /readSessionTokenState:\s*ReadSessionTokenState/u);
  assert.match(
    source,
    /if \(!hasAuthorizationApi && !SpotifyInternalFetch && !hasSession\)/u
  );
});

test("Platform keeps token caller contract and exposes invalidation", () => {
  assert.match(source, /const GetSpotifyAccessToken = \(\): Promise<string> => TokenProvider\.getToken\(\);/u);
  assert.match(source, /const InvalidateSpotifyAccessToken = \(\): void => TokenProvider\.invalidate\(\);/u);
  assert.doesNotMatch(source, /return GetSpotifyAccessToken\(\)/u);
});
