#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import { getJyutpingList } from "to-jyutping";

const SOURCE_URL =
  "https://raw.githubusercontent.com/rime/rime-cantonese/main/jyut6ping3.words.dict.yaml";
const CACHE_PATH = resolve(import.meta.dirname, ".cache/jyut6ping3.words.dict.yaml");
const MOBILE_PATH = resolve(
  import.meta.dirname,
  "../../SpotifyPlus-mobilelyrics/app/src/full/java/com/eza/spicyex/lyrics/JyutpingTrieData.java",
);
const MAX_GENERATED_ENTRIES = 3000;
const GENERATED_COMMENT_PREFIX =
  "// generated from rime-cantonese via tools/generate-jyutping-phrases.mjs";

async function ensureCache() {
  try {
    return await readFile(CACHE_PATH, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await download(SOURCE_URL, CACHE_PATH);
  return readFile(CACHE_PATH, "utf8");
}

function download(url, destination) {
  return new Promise((resolvePromise, reject) => {
    const request = get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), destination)
          .then(resolvePromise, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      const file = createWriteStream(destination, { encoding: "utf8" });
      response.pipe(file);
      file.on("finish", () => file.close(resolvePromise));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function isHanWord(word) {
  const chars = Array.from(word);
  return chars.length >= 2 && chars.length <= 4 && chars.every((char) => /\p{Script=Han}/u.test(char));
}

function parseCandidates(source) {
  const candidates = new Set();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("---") || !line.includes("\t")) continue;

    const [word] = line.split("\t");
    if (word && isHanWord(word)) candidates.add(word);
  }
  return candidates;
}

function readingFor(text) {
  const readings = getJyutpingList(text)?.map((entry) => entry?.[1]);
  return readings?.every(Boolean) ? readings.join(" ") : undefined;
}

function fallbackReadingFor(word) {
  const readings = Array.from(word).map((char) => readingFor(char));
  return readings.every(Boolean) ? readings.join(" ") : undefined;
}

function sortEntries(left, right) {
  const lengthDelta = Array.from(right.word).length - Array.from(left.word).length;
  return lengthDelta || compareByCodepoint(left.word, right.word);
}

function compareByCodepoint(left, right) {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0));
  const rightPoints = Array.from(right, (char) => char.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
    const delta = leftPoints[index] - rightPoints[index];
    if (delta) return delta;
  }
  return leftPoints.length - rightPoints.length;
}

function extractManualRows(javaSource) {
  const rows = [];
  for (const line of javaSource.split(/\r?\n/)) {
    if (line.includes(GENERATED_COMMENT_PREFIX)) break;

    const match = line.match(/^\s*\+\s*"((?:\\.|[^"\\])*)\\n"\s*$/);
    if (!match) continue;
    rows.push(unescapeJavaString(match[1]));
  }
  return rows;
}

function unescapeJavaString(value) {
  return value.replace(/\\([\\"])/g, "$1");
}

function escapeJavaString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rowPhrase(row) {
  return row.split("=")[0];
}

function javaLine(row) {
  return `                + "${escapeJavaString(row)}\\n"`;
}

// javac folds "+"-joined literals into one constant; the pool caps constants at
// 64KB UTF-8, so generated rows are chunked into separate methods and joined at
// runtime via StringBuilder.
const JAVA_CHUNK_ROWS = 700;

function buildJava(manualRows, generatedRows) {
  const chunks = [];
  for (let i = 0; i < generatedRows.length; i += JAVA_CHUNK_ROWS) {
    chunks.push(generatedRows.slice(i, i + JAVA_CHUNK_ROWS));
  }
  const chunkMethods = chunks.flatMap((rows, index) => [
    "",
    `    private static String generated${index}() {`,
    '        return ""',
    ...rows.map(javaLine),
    "                ;",
    "    }",
  ]);
  const appendCalls = chunks.map((_, index) => `        sb.append(generated${index}());`);
  const lines = [
    "package com.eza.spicyex.lyrics;",
    "",
    "final class JyutpingTrieData {",
    "    private JyutpingTrieData() {}",
    "",
    "    static String data() {",
    "        StringBuilder sb = new StringBuilder(manual());",
    ...appendCalls,
    "        return sb.toString();",
    "    }",
    "",
    "    private static String manual() {",
    '        return ""',
    ...manualRows.map(javaLine),
    `                ${GENERATED_COMMENT_PREFIX} (${generatedRows.length} entries)`,
    "                ;",
    "    }",
    ...chunkMethods,
    "}",
    "",
  ];
  return lines.join("\n");
}

const source = await ensureCache();
const candidates = parseCandidates(source);
const kept = [];

for (const word of candidates) {
  const wordReading = readingFor(word);
  const fallbackReading = fallbackReadingFor(word);
  if (wordReading && fallbackReading && wordReading !== fallbackReading) {
    kept.push({ word, reading: wordReading });
  }
}

kept.sort(sortEntries);

const currentJava = await readFile(MOBILE_PATH, "utf8");
const manualRows = extractManualRows(currentJava);
const manualPhrases = new Set(manualRows.map(rowPhrase));
const generatedRows = kept
  .filter(({ word }) => !manualPhrases.has(word))
  .slice(0, MAX_GENERATED_ENTRIES)
  .map(({ word, reading }) => `${word}=${reading}`);

await writeFile(MOBILE_PATH, buildJava(manualRows, generatedRows), "utf8");

console.log(`Rime candidates: ${candidates.size}`);
console.log(`Reading-changing phrases: ${kept.length}`);
console.log(`Manual rows preserved: ${manualRows.length}`);
console.log(`Generated rows emitted: ${generatedRows.length}`);
console.log(`Mobile output: ${MOBILE_PATH}`);
