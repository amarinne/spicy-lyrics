import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const checkSource = read("src/utils/version/CheckForUpdates.tsx");

/**
 * This fork is versioned and released independently of upstream, so the
 * upstream "x.y.z is available" notice must never fire. The scheduled poll in
 * app.tsx still calls CheckForUpdates, which makes that function the single
 * suppression point. The dev-only triggerFakeUpdate path below it intentionally
 * keeps the notice UI exercisable.
 */
test("the fork never polls upstream or presents the update notice", () => {
  const start = checkSource.indexOf("export async function CheckForUpdates");
  assert.ok(start !== -1, "expected CheckForUpdates in CheckForUpdates.tsx");
  const end = checkSource.indexOf("function fakeLatestVersion", start);
  assert.ok(end !== -1, "expected the dev fake-version helper after CheckForUpdates");
  const body = checkSource.slice(start, end);
  for (const marker of [
    "GetLatestVersion",
    "IsBehind",
    "IsOutdated",
    "presentUpdateAvailable",
    "showUpdateModal",
    "showUpdateDismissWarning",
    "ShownUpdateNotice",
  ]) {
    assert.ok(!body.includes(marker), `CheckForUpdates must not reach ${marker}`);
  }
});
