import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const romanizationSource = readFileSync(
  new URL("../src/utils/Lyrics/Fork/Romanization.ts", import.meta.url),
  "utf8"
);

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

/**
 * The @pinyin-pro/data contextual dictionary is ~54MB on disk and inflates the
 * single-file extension bundle to ~95MB. It only improves rare polyphones, so
 * this fork ships pinyin-pro's built-in dictionary instead. These guards keep
 * the heavy dictionary from being reintroduced by a future upstream port.
 */
test("the heavy contextual Mandarin dictionary is not imported", () => {
  assert.doesNotMatch(romanizationSource, /@pinyin-pro\/data/u);
  assert.doesNotMatch(romanizationSource, /\baddDict\b/u);
});

test("the heavy contextual Mandarin dictionary is not a dependency", () => {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  assert.ok(
    !Object.hasOwn(dependencies, "@pinyin-pro/data"),
    "@pinyin-pro/data must stay out of package.json"
  );
  assert.ok(
    Object.hasOwn(dependencies, "pinyin-pro"),
    "pinyin-pro itself is still required for Mandarin romanization"
  );
});
