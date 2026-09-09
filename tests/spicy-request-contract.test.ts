import assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectVersion } from "../project/config.ts";
import { buildSpicyApiHeaders, SPICY_API_MODE } from "../src/utils/API/SpicyRequestContract.ts";

test("Spicy lyrics request matches upstream 6.3.15 contract", () => {
  assert.equal(ProjectVersion, "6.3.15");
  assert.equal(SPICY_API_MODE, "2");
  assert.deepEqual(buildSpicyApiHeaders(ProjectVersion), {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": "6.3.15",
    "X-mode": "2",
  });
  assert.deepEqual(buildSpicyApiHeaders(ProjectVersion, { "SpicyLyrics-WebAuth": "Bearer token" }), {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": "6.3.15",
    "SpicyLyrics-WebAuth": "Bearer token",
    "X-mode": "2",
  });
});
