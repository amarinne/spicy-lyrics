import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

// The processor package (japanese-lyrics-processor) is the single active Japanese
// semantic engine. Legacy Kuroshiro/IPADIC files remain in the tree as dormant
// history, but no production module may invoke their semantic entry points.
// See ../SpotifyPlus-mobilelyrics/docs/JAPANESE_DESKTOP_PARITY_PACKAGE_HANDOVER.md.

const LEGACY_MODULES = new Set([
  "src/utils/Lyrics/Reading/JapaneseReading.ts",
  "src/utils/Lyrics/Processing/Japanese/JapaneseAnnotationProcessor.ts",
  "src/utils/Lyrics/Fork/JukujikunMerge.ts",
  "src/utils/Lyrics/Fork/Romanization.ts",
  "src/utils/Lyrics/Fork/index.ts",
  "src/utils/Lyrics/KuromojiAnalyzer.ts",
]);

const LEGACY_ENTRY_POINTS = [
  "analyzeJapaneseLine",
  "applyJapaneseReadingToSyllables",
  "annotateJapaneseTextTarget",
  "romanizeJapaneseWithFallback",
  "buildRomajiFromTokens",
  "applyContextualReadingOverrides",
  "KuromojiAnalyzer",
  "kuroshiro",
];

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = resolve(root, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

test("production code never invokes the legacy Japanese semantic engine", () => {
  const root = resolve("src");
  for (const file of files(root)) {
    const relative = file.slice(resolve(".").length + 1).replaceAll("\\", "/");
    if (LEGACY_MODULES.has(relative)) continue;
    const source = readFileSync(file, "utf8");
    for (const entry of LEGACY_ENTRY_POINTS) {
      assert.ok(!source.includes(entry), `${relative} references legacy Japanese entry point ${entry}`);
    }
  }
});

test("active Japanese processing enters through japanese-lyrics-processor only", () => {
  const processLyrics = readFileSync(resolve("src/utils/Lyrics/ProcessLyrics.ts"), "utf8");
  assert.match(processLyrics, /from "\.\/Processing\/Japanese\/JapanesePackageProcessor\.ts"/);
  // The only legacy import that may remain is the neutral text-map helper.
  const legacyImports = [...processLyrics.matchAll(/import\s+\{([^}]+)\}\s+from\s+"\.\/Reading\/JapaneseReading\.ts"/g)];
  for (const match of legacyImports) {
    const names = match[1].split(",").map((name) => name.trim().split(" ")[0]).filter(Boolean);
    assert.deepEqual(names, ["buildJapaneseLineTextMap"], `unexpected legacy imports: ${names.join(", ")}`);
  }
});
