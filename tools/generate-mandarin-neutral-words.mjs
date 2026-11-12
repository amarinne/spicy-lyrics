#!/usr/bin/env node
/**
 * Build the Mandarin eza式 dictionary neutral list (decision M1b) from a local CC-CEDICT file.
 *
 * Usage: node tools/generate-mandarin-neutral-words.mjs <cedict.txt or .gz> [output.json]
 * Output (default tools/.cache/mandarin-neutral-words.json, gitignored) is a JSON object:
 *   { "朋友|peng you": [1], ... }
 * The key is a word form (traditional and simplified both appear) and its toneless syllables; the
 * value lists the character positions CC-CEDICT marks neutral (tone 5). A word reading counts only
 * when every entry with those syllable letters agrees on the neutral positions, as in the cjk-labs
 * reference: 东西 (dong1 xi1 / dong1 xi5) gives nothing. Load it with
 * `setMandarinNeutralWords(new Map(Object.entries(json)))`.
 *
 * The output is CC-CEDICT-derived (CC BY-SA 4.0). Do not commit it; shipping it is an owner decision.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const [input, output = resolve(import.meta.dirname, ".cache/mandarin-neutral-words.json")] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node tools/generate-mandarin-neutral-words.mjs <cedict.txt or .gz> [output.json]");
  process.exit(2);
}

const bytes = await readFile(input);
const text = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString("utf8");
const letters = (syllable) => syllable.toLowerCase().replace(/[0-9]+$/u, "").replaceAll("u:", "ü").replaceAll("v", "ü");

/** `${form}|${letters}` -> the distinct neutral-position sets of its entries. */
const readings = new Map();
for (const line of text.split("\n")) {
  const match = /^(\S+) (\S+) \[([^\]]+)\] \//u.exec(line);
  if (!match) continue;
  const syllables = match[3].trim().split(/\s+/u);
  const neutral = syllables.flatMap((syllable, index) => (syllable.endsWith("5") ? [index] : [])).join(",");
  for (const form of new Set([match[1], match[2]])) {
    if (Array.from(form).length < 2 || Array.from(form).length !== syllables.length) continue;
    const key = `${form}|${syllables.map(letters).join(" ")}`;
    if (!readings.has(key)) readings.set(key, new Set());
    readings.get(key).add(neutral);
  }
}

const words = {};
for (const [key, sets] of [...readings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  const [only] = sets;
  if (sets.size === 1 && only) words[key] = only.split(",").map(Number);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(words)}\n`);
console.log(`${Object.keys(words).length} neutral word readings -> ${output}`);
