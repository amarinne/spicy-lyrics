import assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectVersion } from "../project/config.ts";
import {
  buildSpicyApiHeaders,
  buildSpicyLyricsQueryBody,
  buildSpicyLyricsQueryHeaders,
  SPICY_API_MODE,
} from "../src/utils/API/SpicyRequestContract.ts";

const TRACK_ID = "4uLU6hMCjMI75M1A2tKUQC";

test("Spicy lyrics request matches upstream 6.3.12 contract", () => {
  assert.equal(ProjectVersion, "6.3.12");
  assert.equal(SPICY_API_MODE, "2");
  assert.deepEqual(buildSpicyApiHeaders(ProjectVersion), {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": "6.3.12",
    "X-mode": "2",
  });
  assert.equal(
    buildSpicyLyricsQueryBody(TRACK_ID, ProjectVersion),
    '{"queries":[{"operation":"lyrics","variables":{"id":"4uLU6hMCjMI75M1A2tKUQC","auth":"SpicyLyrics-WebAuth"}}],"client":{"version":"6.3.12"}}',
  );
  assert.deepEqual(buildSpicyLyricsQueryHeaders(ProjectVersion, "token"), {
    "Content-Type": "application/json",
    "SpicyLyrics-Version": "6.3.12",
    "SpicyLyrics-WebAuth": "Bearer token",
    "X-mode": "2",
  });
});
