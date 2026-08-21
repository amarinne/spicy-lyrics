import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const read = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const uiState = read("src/utils/uiState.ts");
const settingsSection = read("src/components/ReactComponents/SettingsPanel/LyricsSection.tsx");
const pageView = read("src/components/Pages/PageView.ts");

/**
 * Placement governs jyutping as well as pinyin, and the reading either attaches to spans or sits in
 * the line row — never both. These guards keep the wiring that makes that true.
 */
test("placement defaults to the existing line-level behavior", () => {
  assert.match(
    uiState,
    /\$chineseReadingPlacement\s*=\s*persistAtom<ChineseReadingPlacement>\("chineseReadingPlacement",\s*"lineBelow"\)/u
  );
});

test("placement offers all three states", () => {
  assert.match(uiState, /"lineBelow"\s*\|\s*"wordBelow"\s*\|\s*"wordAbove"/u);
});

test("changing placement reprocesses instead of serving a stale plan", () => {
  assert.match(pageView, /\$chineseReadingPlacement\.listen\(queueProcessingSettingsRefresh\)/u);
});

test("word grouping is disabled once readings sit on their own words", () => {
  assert.match(settingsSection, /chineseReadingPlacement !== "lineBelow"/u);
});
