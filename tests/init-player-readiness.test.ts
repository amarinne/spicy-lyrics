import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("an unready Spicetify player cannot abort the init block", () => {
  // Spicetify's isPlaying() reads `_state.isPaused` while `_state` is still null
  // during startup. This call sits at the top of the init block that registers
  // the platform history listener, so an unguarded throw there silently kills
  // the rest of the block and the lyrics page never opens on navigation.
  const addons = read("src/utils/Addons.ts");
  const isPlaying = addons.match(/function IsPlaying\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(isPlaying, /try \{/);
  assert.match(isPlaying, /catch \{/);
  assert.match(isPlaying, /return false/);

  // The listener that drives page mounting must be registered in the same block.
  const app = read("src/app.tsx");
  assert.match(app, /Whentil\.When\(GetPageRoot/);
  assert.match(app, /History\.listen\(\(e: Location\) => \{\s*Global\.Event\.evoke\("platform:history", e\)/);
});