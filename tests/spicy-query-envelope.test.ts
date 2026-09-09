import assert from "node:assert/strict";
import { test } from "node:test";

import { extractSpicyQueryResult } from "../src/utils/API/SpicyRequestContract.ts";

test("server notice entry no longer hides the real query result", () => {
  const envelope = [
    { _notice: "Access is granted solely for personal, individual use through official Spicy Lyrics clients." },
    { operation: "lyrics", operationId: "0", result: { data: { Type: "Line", Content: [] }, httpStatus: 200, format: "json" } },
  ];
  const result = extractSpicyQueryResult(envelope);
  assert.equal(result?.httpStatus, 200);
  assert.ok(result?.data);
});

test("legacy single-entry envelopes keep working", () => {
  const envelope = [{ operationId: "0", result: { data: { error: "Spotify API error" }, httpStatus: 429, format: "json" } }];
  assert.equal(extractSpicyQueryResult(envelope)?.httpStatus, 429);
});

test("missing, notice-only, and malformed envelopes yield no result", () => {
  assert.equal(extractSpicyQueryResult(undefined), undefined);
  assert.equal(extractSpicyQueryResult([]), undefined);
  assert.equal(extractSpicyQueryResult([{ _notice: "policy text" }]), undefined);
  assert.equal(extractSpicyQueryResult("not-an-envelope"), undefined);
});
