import assert from "node:assert/strict";
import { test } from "node:test";
import { timedLogicalGroupIds } from "../src/utils/Lyrics/Processing/Japanese/TimedGroupIds.ts";

test("semantic groups follow provider owner IDs after blank fragments", () => {
  const groups = timedLogicalGroupIds({
    lineId: "jp", sourceUnits: [], readingUnits: [], joinedDisplayText: "hantannaku",
    timedReadingUnits: [
      { spanId: "0", canonicalRange: { startCp: 0, endCp: 1 }, text: "han", logicalGroupId: "jp-0" },
      { spanId: "2", canonicalRange: { startCp: 1, endCp: 2 }, text: "tan", logicalGroupId: "jp-0" },
      { spanId: "3", canonicalRange: { startCp: 2, endCp: 4 }, text: "naku", logicalGroupId: "jp-1" },
    ],
  });
  assert.equal(groups.get("0"), "jp-0");
  assert.equal(groups.get("1"), undefined);
  assert.equal(groups.get("2"), "jp-0");
  assert.equal(groups.get("3"), "jp-1");
});
