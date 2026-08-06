import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectScrollLineIndex,
  type ScrollTimingLine,
} from "../src/utils/Scrolling/ScrollLineSelection.ts";

test("scroll selection returns no target outside timed lines", () => {
  const lines: ScrollTimingLine[] = [
    { StartTime: 10, EndTime: 20 },
    { StartTime: 30, EndTime: 40 },
  ];
  assert.equal(selectScrollLineIndex(lines, 5), null);
});

test("background lines resolve to their owning lead line", () => {
  const lines: ScrollTimingLine[] = [
    { StartTime: 0, EndTime: 5 },
    { StartTime: 0, EndTime: 10, BGLine: true },
  ];
  assert.equal(selectScrollLineIndex(lines, 7), 0);
});

test("upper active line stays pinned when its group clears before lookahead", () => {
  const lines: ScrollTimingLine[] = [
    { StartTime: 0, EndTime: 10 },
    { StartTime: 0, EndTime: 7, BGLine: true },
    { StartTime: 5, EndTime: 8 },
    { StartTime: 12, EndTime: 16 },
  ];
  assert.equal(selectScrollLineIndex(lines, 6), 0);
});

test("overlapping lookahead advances to the later active lead", () => {
  const lines: ScrollTimingLine[] = [
    { StartTime: 0, EndTime: 10 },
    { StartTime: 0, EndTime: 9, BGLine: true },
    { StartTime: 5, EndTime: 8 },
    { StartTime: 7, EndTime: 12 },
  ];
  assert.equal(selectScrollLineIndex(lines, 7), 3);
});

test("background lines do not consume lookahead slots", () => {
  const lines: ScrollTimingLine[] = [
    { StartTime: 0, EndTime: 10 },
    { StartTime: 0, EndTime: 12, BGLine: true },
    { StartTime: 0, EndTime: 11, BGLine: true },
    { StartTime: 5, EndTime: 8 },
    { StartTime: 5, EndTime: 9, BGLine: true },
    { StartTime: 13, EndTime: 16 },
  ];
  assert.equal(selectScrollLineIndex(lines, 6), 0);
});
