/**
 * Synchronous Mandarin reading engine over pinned g2pM weights and pinyin/phrase data.
 *
 * Loading is the caller's job. The core has no fetch, filesystem, timer, Python or Node import.
 */

import type {
  MandarinEngine,
  MandarinEngineAssets,
  MandarinModelEvidence,
  MandarinPhraseEvidence,
  MandarinPhraseMatch,
  MandarinReadingCounts,
  MandarinReadingLine,
  MandarinSyllable,
  MandarinTelemetry,
} from "./contracts.ts";
import { MANDARIN_G2PM_READING_SCHEMA } from "./contracts.ts";
import {
  parseCharacterTable,
  parseClasses,
  parseManifest,
  parseModelTensors,
  parseModelVocab,
  parsePhrases,
  parseT2s,
  type CharacterEntry,
} from "./data.ts";
import { G2pMModel, type ModelPrediction } from "./model.ts";
import {
  canonicalNumbered,
  citationFromCandidates,
  isNeutral,
  markedFromNumbered,
} from "./pinyin.ts";

const HAN = /^\p{Script=Han}$/u;

type PhraseSelection = Readonly<{
  text: string;
  /** Full numbered phrase reading for an exact-run entry, or one numbered syllable for a fill. */
  raw: string;
  readings: readonly string[];
  range: readonly [number, number];
}>;

type PreparedCharacter = Readonly<{
  char: string;
  normalizedChar: string;
  /** Original code point when the model vocabulary knows it, otherwise the 1:1 shadow. */
  modelChar: string;
  han: boolean;
  entry?: CharacterEntry;
  digestReadings: readonly string[];
  inModelVocabulary: boolean;
}>;

export function createMandarinEngine(assets: MandarinEngineAssets, options: Readonly<{ phrases?: boolean }> = {}): MandarinEngine {
  const started = performance.now();
  const manifest = parseManifest(assets.manifest);
  const words = parseModelVocab(assets.vocab);
  const classes = parseClasses(assets.classes);
  if (manifest.counts.vocab !== words.tokens.length) throw new TypeError("Manifest vocabulary count differs from model vocab.");
  if (manifest.counts.classes !== classes.length) throw new TypeError("Manifest class count differs from classes.txt.");
  const characterTable = parseCharacterTable(assets.characters);
  if (manifest.counts.characters !== characterTable.size) throw new TypeError("Manifest character count differs from characters.tsv.");
  const t2s = parseT2s(assets.t2s);
  if (manifest.counts.t2s !== t2s.size) throw new TypeError("Manifest t2s count differs from t2s.tsv.");
  const digest = parseDigest(assets.digest);
  if (manifest.counts.digest !== digest.size) throw new TypeError("Manifest digest count differs from digest.json.");
  const usePhrases = options.phrases !== false;
  const parsedPhrases = usePhrases && assets.phrases
    ? parsePhrases(assets.phrases)
    : { table: new Map<string, string[][]>(), rows: 0 };
  if (usePhrases && manifest.counts.phrases !== parsedPhrases.rows) {
    throw new TypeError("Manifest phrase count differs from phrases.tsv.");
  }
  const tensors = parseModelTensors(manifest, assets.model);
  const model = new G2pMModel(tensors, words.tokens.length, classes);
  const maxPhraseLength = maxPhrase(parsedPhrases.table);
  const modelParameters = [...tensors.values()].reduce((total, tensor) => total + tensor.values.length, 0);
  const parseMs = performance.now() - started;

  let reads = 0;
  let totalReadMs = 0;
  let lastRead = { inputCodePoints: 0, modelTokens: 0, modelPositions: 0, milliseconds: 0 };

  function phraseForRun(run: string): PhraseSelection | undefined {
    const rows = parsedPhrases.table.get(run);
    if (!rows || rows.length === 0) return undefined;
    const distinct = new Map<string, readonly string[]>();
    for (const reading of rows) distinct.set(reading.join(" "), reading);
    if (distinct.size !== 1) return undefined;
    const readings = [...distinct.values()][0]!;
    return { text: run, raw: readings.join(" "), readings, range: [0, 0] };
  }

  function coveringPhrase(chars: readonly string[], index: number, runStart: number, runEnd: number): MandarinPhraseEvidence | undefined {
    const longest = Math.min(maxPhraseLength, runEnd - runStart);
    for (let length = longest; length >= 2; length -= 1) {
      for (let start = Math.max(runStart, index - length + 1); start <= index; start += 1) {
        if (start + length > runEnd) continue;
        const text = chars.slice(start, start + length).join("");
        const rows = parsedPhrases.table.get(text);
        if (!rows) continue;
        const distinct = new Map<string, readonly string[]>();
        for (const reading of rows) distinct.set(reading.join(" "), reading);
        const [raw, readings] = [...distinct.entries()][0] ?? [];
        if (raw && readings) return { text, raw, range: [start, start + length] };
      }
    }
    return undefined;
  }

  /**
   * Fill only positions that the g2pM model does not decide. A position gets the reading from its
   * longest covering phrase; equal-length conflicts with different readings stay at the character
   * default. This supplies lexical neutral readings inside longer sentences (哥哥, 朋友) without
   * overriding a model polyphone decision (的|确实, 了|结局).
   */
  function fillFromPhrases(
    chars: readonly string[],
    start: number,
    end: number,
    target: Map<number, PhraseSelection>,
  ): void {
    type Best = { length: number; readings: Set<string>; text: string; range: readonly [number, number] };
    const best = new Map<number, Best>();
    for (let offset = start; offset < end; offset += 1) {
      const limit = Math.min(maxPhraseLength, end - offset);
      for (let length = limit; length >= 2; length -= 1) {
        const text = chars.slice(offset, offset + length).join("");
        const rows = parsedPhrases.table.get(text);
        if (!rows) continue;
        for (const phrase of new Set(rows.map((reading) => reading.join(" ")))) {
          const syllables = phrase.split(" ");
          for (let offsetInPhrase = 0; offsetInPhrase < length; offsetInPhrase += 1) {
            const index = offset + offsetInPhrase;
            const reading = syllables[offsetInPhrase]!;
            const current = best.get(index);
            if (!current || length > current.length) {
              best.set(index, { length, readings: new Set([reading]), text, range: [offset, offset + length] });
            } else if (length === current.length) {
              current.readings.add(reading);
            }
          }
        }
      }
    }
    for (const [index, item] of best) {
      if (item.readings.size !== 1) continue;
      const reading = [...item.readings][0]!;
      target.set(index, { text: item.text, raw: reading, readings: [reading], range: item.range });
    }
  }

  function read(text: string, readOptions: Readonly<{ explain?: boolean }> = {}): MandarinReadingLine {
    const began = performance.now();
    const sourceChars = Array.from(text);
    const normalizedChars = sourceChars.map((char) => t2s.get(char) ?? char);
    if (normalizedChars.length !== sourceChars.length) throw new TypeError("t2s normalization must be one-to-one.");

    const prepared: PreparedCharacter[] = sourceChars.map((char, index) => {
      const normalizedChar = normalizedChars[index]!;
      const han = HAN.test(char);
      const entry = han ? characterTable.get(char) ?? characterTable.get(normalizedChar) : undefined;
      // Preserve the source code point in model context when the pinned vocabulary knows it;
      // traditional-only characters fall back to the documented 1:1 simplified shadow.
      const modelChar = han && words.tokenToIndex.has(char) ? char : normalizedChar;
      const originalDigest = han ? digest.get(char) ?? [] : [];
      const shadowDigest = han && normalizedChar !== char ? digest.get(normalizedChar) ?? [] : [];
      const digestReadings = [...new Set([...originalDigest, ...shadowDigest])];
      return {
        char,
        normalizedChar,
        modelChar,
        han,
        ...(entry ? { entry } : {}),
        digestReadings,
        inModelVocabulary: han && words.tokenToIndex.has(modelChar),
      };
    });

    const exactPhraseSelections = new Map<number, PhraseSelection>();
    const phraseFill = new Map<number, PhraseSelection>();
    if (usePhrases) {
      // An exact whole-input entry is authoritative. Sub-run entries are not: without a parser,
      // 的|确实 can match 的确 and 了|结局 can match 了结. Sub-run entries supply defaults only
      // for positions the g2pM model does not decide.
      const wholeHan = prepared.length > 0 && prepared.every((item) => item.han);
      const whole = wholeHan ? phraseForRun(normalizedChars.join("")) : undefined;
      if (whole) {
        for (let index = 0; index < normalizedChars.length; index += 1) {
          exactPhraseSelections.set(index, { ...whole, range: [0, normalizedChars.length] });
        }
      } else {
        for (const [start, end] of hanRuns(prepared)) fillFromPhrases(normalizedChars, start, end, phraseFill);
      }
    }

    const modelPositions: number[] = [];
    for (const [index, item] of prepared.entries()) {
      if (!item.han || exactPhraseSelections.has(index)) continue;
      if (item.digestReadings.length > 1 && item.inModelVocabulary) modelPositions.push(index);
    }

    let modelPredictions = new Map<number, ModelPrediction>();
    let modelTokens = 0;
    if (modelPositions.length > 0) {
      const ids = [
        words.bosIndex,
        ...prepared.map((item) => words.tokenToIndex.get(item.modelChar) ?? words.unkIndex),
        words.eosIndex,
      ];
      modelTokens = ids.length;
      const shifted = model.predict(ids, modelPositions.map((index) => index + 1));
      for (const [position, prediction] of shifted) modelPredictions.set(position - 1, prediction);
    }

    const syllables: MandarinSyllable[] = [];
    const counts = { total: sourceChars.length, model: 0, phrase: 0, default: 0, passthrough: 0, unavailable: 0 };

    for (const [index, item] of prepared.entries()) {
      if (!item.han) {
        syllables.push({ status: "passthrough", index, char: item.char, normalizedChar: item.normalizedChar, text: item.char });
        counts.passthrough += 1;
        continue;
      }
      const entry = item.entry;
      const exactPhrase = exactPhraseSelections.get(index);
      const exactReading = exactPhrase?.readings[index - exactPhrase.range[0]];
      const fillPhrase = phraseFill.get(index);
      const fillReading = fillPhrase?.readings[0];
      const prediction = modelPredictions.get(index);
      const modelReading = prediction?.top[0]?.raw;
      const candidates = entry?.candidates ?? item.digestReadings;

      let raw: string | undefined;
      let source: "phrase" | "model" | "default" = "default";
      if (exactReading) {
        raw = exactReading;
        source = "phrase";
        counts.phrase += 1;
      } else if (modelReading) {
        raw = modelReading;
        source = "model";
        counts.model += 1;
      } else if (fillReading) {
        raw = fillReading;
        source = "phrase";
        counts.phrase += 1;
      } else if (entry) {
        raw = entry.defaultReading;
        source = "default";
        counts.default += 1;
      } else if (item.digestReadings.length === 1) {
        raw = item.digestReadings[0];
        source = "default";
        counts.default += 1;
      } else {
        syllables.push({
          status: "unavailable",
          index,
          char: item.char,
          normalizedChar: item.normalizedChar,
          reason: entry ? "no-reading" : "no-character-data",
        });
        counts.unavailable += 1;
        continue;
      }

      if (raw === undefined) {
        syllables.push({
          status: "unavailable",
          index,
          char: item.char,
          normalizedChar: item.normalizedChar,
          reason: "no-reading",
        });
        counts.unavailable += 1;
        continue;
      }
      const selected = canonicalNumbered(raw) ?? raw;
      const alternatives = candidates.includes(selected) ? candidates : [selected, ...candidates];
      const modelEvidence: MandarinModelEvidence | undefined = prediction?.top[0]
        ? {
            raw: selected,
            probability: prediction.top[0].probability,
            candidateMatch: candidates.includes(selected),
            ...(readOptions.explain ? { top: prediction.top } : {}),
          }
        : undefined;
      const selectedPhrase = exactPhrase ?? fillPhrase;
      const phraseEvidence: MandarinPhraseEvidence | undefined = selectedPhrase
        ? { text: selectedPhrase.text, raw: selectedPhrase.raw, range: selectedPhrase.range }
        : readOptions.explain
          ? coveringPhrase(normalizedChars, index, hanRunStart(prepared, index), hanRunEnd(prepared, index))
          : undefined;
      syllables.push({
        status: "reading",
        index,
        char: item.char,
        normalizedChar: item.normalizedChar,
        raw: selected,
        display: markedFromNumbered(selected),
        citation: citationFromCandidates(selected, alternatives),
        neutral: isNeutral(selected),
        source,
        candidates,
        ...(phraseEvidence ? { phrase: phraseEvidence } : {}),
        ...(modelEvidence ? { model: modelEvidence } : {}),
      });
    }

    const result: MandarinReadingLine = {
      schema: MANDARIN_G2PM_READING_SCHEMA,
      input: text,
      normalized: normalizedChars.join(""),
      syllables,
      counts,
    };
    reads += 1;
    const milliseconds = performance.now() - began;
    totalReadMs += milliseconds;
    lastRead = { inputCodePoints: sourceChars.length, modelTokens, modelPositions: modelPositions.length, milliseconds };
    return result;
  }

  function lookupPhrases(text: string): readonly MandarinPhraseMatch[] {
    const chars = Array.from(text);
    const normalized = chars.map((char) => t2s.get(char) ?? char);
    const matches: MandarinPhraseMatch[] = [];
    for (const [start, end] of hanRuns(chars.map((char, index) => ({
      char,
      normalizedChar: normalized[index]!,
      modelChar: normalized[index]!,
      han: HAN.test(char),
      digestReadings: [],
      inModelVocabulary: false,
    })))) {
      for (let offset = start; offset < end; offset += 1) {
        const limit = Math.min(maxPhraseLength, end - offset);
        for (let length = limit; length >= 2; length -= 1) {
          const phrase = normalized.slice(offset, offset + length).join("");
          const rows = parsedPhrases.table.get(phrase);
          if (!rows) continue;
          const readings = [...new Set(rows.map((reading) => reading.join(" ")))];
          matches.push({
            text: phrase,
            range: [offset, offset + length],
            readings,
            unambiguous: readings.length === 1,
          });
        }
      }
    }
    return matches;
  }

  return {
    read,
    lookupPhrases,
    telemetry(): MandarinTelemetry {
      return {
        initialization: {
          modelBytes: assets.model.byteLength,
          modelParameters,
          characters: characterTable.size,
          classes: classes.length,
          phrases: parsedPhrases.rows,
          t2s: t2s.size,
          parseMs,
        },
        reads,
        lastRead,
        totalReadMs,
      };
    },
  };
}

function parseDigest(source: string): Map<string, string[]> {
  const parsed = JSON.parse(source) as Record<string, string[]>;
  const table = new Map<string, string[]>();
  for (const [char, readings] of Object.entries(parsed)) {
    if (!Array.isArray(readings) || readings.length === 0) throw new TypeError(`Malformed digest entry ${char}.`);
    const canonical = readings.map(canonicalNumbered);
    if (canonical.some((reading) => reading === undefined)) throw new TypeError(`Malformed digest reading for ${char}.`);
    table.set(char, canonical as string[]);
  }
  return table;
}

function hanRuns(prepared: readonly PreparedCharacter[]): Array<readonly [number, number]> {
  const runs: Array<readonly [number, number]> = [];
  let start = -1;
  for (let index = 0; index < prepared.length; index += 1) {
    if (prepared[index]!.han) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      runs.push([start, index]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, prepared.length]);
  return runs;
}

function hanRunEnd(prepared: readonly PreparedCharacter[], index: number): number {
  let end = index;
  while (end < prepared.length && prepared[end]!.han) end += 1;
  return end;
}

function hanRunStart(prepared: readonly PreparedCharacter[], index: number): number {
  let start = index;
  while (start > 0 && prepared[start - 1]!.han) start -= 1;
  return start;
}

function maxPhrase(table: ReadonlyMap<string, readonly (readonly string[])[]>): number {
  let maximum = 2;
  for (const key of table.keys()) {
    const length = Array.from(key).length;
    if (length > maximum) maximum = length;
  }
  return maximum;
}
