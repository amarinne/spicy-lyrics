/**
 * Portable Mandarin g2pM reading contract.
 *
 * The contract is deliberately small: one synchronous `read(text)` call returns one entry per
 * source code point. The core module imports no Node API and performs no I/O.
 */

export const MANDARIN_G2PM_READING_SCHEMA = "cjk-labs.zh.mandarin-g2pm.reading.v1";
export const MANDARIN_G2PM_MANIFEST_SCHEMA = "cjk-labs.zh.mandarin-g2pm.manifest.v1";
export const MANDARIN_G2PM_DATA_FORMAT = "mandarin-g2pm-f32-v1";

export type MandarinReadingSource = "phrase" | "model" | "default";
export type MandarinTopReading = Readonly<{
  raw: string;
  probability: number;
  logit: number;
}>;

export type MandarinModelEvidence = Readonly<{
  /** Raw top-1 class after canonicalising the g2pM label (`lu:3` becomes `lü3`). */
  raw: string;
  /** Stable softmax probability of the top class. */
  probability: number;
  /** Whether the top class is one of the character's pinyin-data candidates. */
  candidateMatch: boolean;
  /** Present only when `read(text, { explain: true })` is used. */
  top?: readonly MandarinTopReading[];
}>;

export type MandarinPhraseEvidence = Readonly<{
  /** Exact phrase text in the 1:1 simplified shadow. */
  text: string;
  /** Numbered phrase reading. */
  raw: string;
  /** Code-point range `[start, end)` in the original input. */
  range: readonly [number, number];
}>;

export type MandarinReadingSyllable = Readonly<{
  status: "reading";
  /** Code-point index in the original source, never a UTF-16 offset. */
  index: number;
  /** Original source code point. */
  char: string;
  /** 1:1 simplified shadow code point, used for phrase lookup and as the model fallback. */
  normalizedChar: string;
  /** Selected numbered reading. Neutral is `5`; `ü` is preserved. */
  raw: string;
  /** Marked standard Pinyin. A raw neutral `5` is unmarked. */
  display: string;
  /**
   * Separate full-citation alternative. Equal to `raw` for tones 1-4, and a same-letters full-tone
   * candidate for a neutral raw. Never the selected Standard Pinyin by itself.
   */
  citation: string;
  neutral: boolean;
  source: MandarinReadingSource;
  /** Attested numbered alternatives from pinyin-data, ordered by the source. */
  candidates: readonly string[];
  phrase?: MandarinPhraseEvidence;
  model?: MandarinModelEvidence;
}>;

export type MandarinPassthroughSyllable = Readonly<{
  status: "passthrough";
  index: number;
  char: string;
  normalizedChar: string;
  /** The original code point, unchanged. */
  text: string;
}>;

export type MandarinUnavailableSyllable = Readonly<{
  status: "unavailable";
  index: number;
  char: string;
  normalizedChar: string;
  reason: "no-character-data" | "no-reading";
}>;

export type MandarinSyllable =
  | MandarinReadingSyllable
  | MandarinPassthroughSyllable
  | MandarinUnavailableSyllable;

export type MandarinReadingCounts = Readonly<{
  total: number;
  model: number;
  phrase: number;
  default: number;
  passthrough: number;
  unavailable: number;
}>;

export type MandarinReadingLine = Readonly<{
  schema: typeof MANDARIN_G2PM_READING_SCHEMA;
  input: string;
  /** The 1:1 simplified shadow. `Array.from(normalized).length === syllables.length`. */
  normalized: string;
  syllables: readonly MandarinSyllable[];
  counts: MandarinReadingCounts;
}>;

export type MandarinEngineOptions = Readonly<{
  /**
   * Load the phrase table and expose phrase evidence. Default true. Turning it off keeps the model
   * and character defaults, but exact whole-run phrase entries are no longer selected.
   */
  phrases?: boolean;
}>;

export type MandarinPhraseMatch = Readonly<{
  text: string;
  range: readonly [number, number];
  readings: readonly string[];
  /** Exactly one distinct reading is available. */
  unambiguous: boolean;
}>;

export type MandarinTelemetry = Readonly<{
  initialization: Readonly<{
    modelBytes: number;
    modelParameters: number;
    characters: number;
    classes: number;
    phrases: number;
    t2s: number;
    parseMs: number;
  }>;
  reads: number;
  lastRead: Readonly<{
    inputCodePoints: number;
    modelTokens: number;
    modelPositions: number;
    milliseconds: number;
  }>;
  totalReadMs: number;
}>;

export interface MandarinEngine {
  /** Synchronous reading. Each entry maps to exactly one source code point. */
  read(text: string, options?: Readonly<{ explain?: boolean }>): MandarinReadingLine;
  /** All phrase-table matches inside Han runs, longest first. Evidence only; not selected. */
  lookupPhrases(text: string): readonly MandarinPhraseMatch[];
  telemetry(): MandarinTelemetry;
}

export type ModelTensorSpec = Readonly<{
  name: string;
  offset: number;
  shape: readonly number[];
}>;

export type MandarinManifest = Readonly<{
  schema: typeof MANDARIN_G2PM_MANIFEST_SCHEMA;
  format: typeof MANDARIN_G2PM_DATA_FORMAT;
  algorithm: string;
  model: Readonly<{
    file: string;
    dtype: "float32";
    byteOrder: "little-endian";
    byteLength: number;
    tensors: readonly ModelTensorSpec[];
  }>;
  files: Readonly<Record<string, Readonly<{ sha256: string; bytes: number }>>>;
  sources: readonly Readonly<{
    id: string;
    version: string;
    commit?: string;
    url: string;
    sha256: string;
    license: string;
    licenseUrl: string;
    files?: readonly string[];
  }>[];
  policy: Readonly<{
    id: string;
    summary: string;
  }>;
  counts: Readonly<{
    characters: number;
    phrases: number;
    t2s: number;
    classes: number;
    vocab: number;
    digest: number;
  }>;
}>;

export type MandarinEngineAssets = Readonly<{
  manifest: MandarinManifest;
  /** Raw contents of `model.f32`, little-endian float32. */
  model: ArrayBuffer;
  /** Parsed `model-vocab.json`. */
  vocab: Readonly<{
    tokens: readonly string[];
    padIndex: number;
    unkIndex: number;
    bosIndex: number;
    eosIndex: number;
  }>;
  /** Raw `classes.txt`. */
  classes: string;
  /** Raw `characters.tsv`. */
  characters: string;
  /** Raw `digest.json`: the g2pM package's character-to-reading digest. */
  digest: string;
  /** Raw `phrases.tsv`; optional when phrase evidence is disabled. */
  phrases?: string;
  /** Raw `t2s.tsv`. */
  t2s: string;
}>;
