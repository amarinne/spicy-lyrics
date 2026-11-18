/** Parsers for the exported asset files. No I/O is performed here. */

import type { MandarinManifest, ModelTensorSpec } from "./contracts.ts";
import { canonicalNumbered, uniqueReadings } from "./pinyin.ts";

export type CharacterEntry = Readonly<{
  char: string;
  defaultReading: string;
  candidates: readonly string[];
  defaultSource: "8105" | "pinyin";
}>;

export type PhraseTable = ReadonlyMap<string, readonly (readonly string[])[]>;

export type ModelTensor = Readonly<{
  spec: ModelTensorSpec;
  values: Float32Array;
}>;

export function parseCharacterTable(source: string): Map<string, CharacterEntry> {
  const entries = new Map<string, CharacterEntry>();
  for (const line of source.split("\n")) {
    if (!line) continue;
    const [codePointHex, defaultRaw, candidateField, defaultSource] = line.split("\t");
    if (!codePointHex || !defaultRaw || !candidateField || (defaultSource !== "8105" && defaultSource !== "pinyin")) {
      throw new TypeError(`Malformed character row: ${line.slice(0, 80)}`);
    }
    const char = String.fromCodePoint(Number.parseInt(codePointHex, 16));
    const defaultReading = canonicalNumbered(defaultRaw);
    const candidates = uniqueReadings(candidateField.split(","));
    if (!defaultReading || candidates.length === 0 || !candidates.includes(defaultReading)) {
      throw new TypeError(`Character row has inconsistent readings: ${codePointHex}`);
    }
    if (entries.has(char)) throw new TypeError(`Duplicate character row: ${codePointHex}`);
    entries.set(char, { char, defaultReading, candidates, defaultSource });
  }
  return entries;
}

export function parsePhrases(source: string): { table: Map<string, string[][]>; rows: number } {
  const table = new Map<string, string[][]>();
  let rows = 0;
  for (const line of source.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) throw new TypeError(`Malformed phrase row: ${line.slice(0, 80)}`);
    const text = line.slice(0, tab);
    const readings = line.slice(tab + 1).split(" ");
    if (readings.length !== Array.from(text).length) {
      throw new TypeError(`Phrase reading does not align: ${text}`);
    }
    const canonical = readings.map(canonicalNumbered);
    if (canonical.some((reading) => reading === undefined)) {
      throw new TypeError(`Phrase has a malformed reading: ${text}`);
    }
    const list = table.get(text);
    if (list) list.push(canonical as string[]);
    else table.set(text, [canonical as string[]]);
    rows += 1;
  }
  return { table, rows };
}

export function parseT2s(source: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const line of source.split("\n")) {
    if (!line) continue;
    const [from, to, extra] = line.split("\t");
    if (!from || !to || extra !== undefined
      || Array.from(from).length !== 1 || Array.from(to).length !== 1 || from === to) {
      throw new TypeError(`Malformed traditional/simplified row: ${line}`);
    }
    table.set(from, to);
  }
  return table;
}

export type ParsedVocab = Readonly<{
  tokens: readonly string[];
  tokenToIndex: ReadonlyMap<string, number>;
  padIndex: number;
  unkIndex: number;
  bosIndex: number;
  eosIndex: number;
}>;

export function parseModelVocab(source: Readonly<{
  tokens: readonly string[];
  padIndex: number;
  unkIndex: number;
  bosIndex: number;
  eosIndex: number;
}>): ParsedVocab {
  const { tokens, padIndex, unkIndex, bosIndex, eosIndex } = source;
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.some((token) => typeof token !== "string")) {
    throw new TypeError("Model vocabulary tokens are invalid.");
  }
  const tokenToIndex = new Map<string, number>();
  for (const [index, token] of tokens.entries()) {
    if (tokenToIndex.has(token)) throw new TypeError(`Duplicate model vocabulary token: ${token}`);
    tokenToIndex.set(token, index);
  }
  for (const [name, index] of [["pad", padIndex], ["unk", unkIndex], ["bos", bosIndex], ["eos", eosIndex]] as const) {
    if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
      throw new TypeError(`Model vocabulary ${name} index is invalid.`);
    }
  }
  if (tokens[padIndex] !== "<PAD>" || tokens[unkIndex] !== "<UNK>"
    || tokens[bosIndex] !== "시" || tokens[eosIndex] !== "끝") {
    throw new TypeError("Model vocabulary special tokens differ from the pinned g2pM vocabulary.");
  }
  return { tokens, tokenToIndex, padIndex, unkIndex, bosIndex, eosIndex };
}

export function parseClasses(source: string): string[] {
  const classes = source.split("\n").filter((line) => line.length > 0);
  if (classes.length === 0) throw new TypeError("Class table is empty.");
  const seen = new Set<string>();
  for (const label of classes) {
    const canonical = canonicalNumbered(label);
    if (!canonical) throw new TypeError(`Malformed g2pM class label: ${label}`);
    if (seen.has(canonical)) throw new TypeError(`Duplicate g2pM class label: ${label}`);
    seen.add(canonical);
  }
  return classes;
}

export function parseManifest(source: unknown): MandarinManifest {
  if (!source || typeof source !== "object") throw new TypeError("Manifest must be an object.");
  const manifest = source as MandarinManifest;
  if (manifest.schema !== "cjk-labs.zh.mandarin-g2pm.manifest.v1" || manifest.format !== "mandarin-g2pm-f32-v1") {
    throw new TypeError("Manifest schema or data format is unsupported.");
  }
  if (!manifest.model || manifest.model.dtype !== "float32" || manifest.model.byteOrder !== "little-endian"
    || !Array.isArray(manifest.model.tensors) || manifest.model.tensors.length === 0) {
    throw new TypeError("Manifest model layout is invalid.");
  }
  return manifest;
}

export function parseModelTensors(manifest: MandarinManifest, buffer: ArrayBuffer): Map<string, ModelTensor> {
  if (buffer.byteLength !== manifest.model.byteLength) {
    throw new TypeError(`Model byte length ${buffer.byteLength} differs from manifest ${manifest.model.byteLength}.`);
  }
  const tensors = new Map<string, ModelTensor>();
  const bytes = new Uint8Array(buffer);
  for (const spec of manifest.model.tensors) {
    const length = spec.shape.reduce((product, size) => product * size, 1);
    const expectedBytes = length * 4;
    if (!Number.isInteger(spec.offset) || spec.offset < 0 || spec.offset % 4 !== 0
      || spec.offset + expectedBytes > bytes.byteLength) {
      throw new TypeError(`Tensor ${spec.name} has an invalid offset.`);
    }
    if (tensors.has(spec.name)) throw new TypeError(`Duplicate tensor ${spec.name}.`);
    tensors.set(spec.name, { spec, values: new Float32Array(buffer, spec.offset, length) });
  }
  return tensors;
}

export function tensorValues(tensors: ReadonlyMap<string, ModelTensor>, name: string, shape?: readonly number[]): Float32Array {
  const tensor = tensors.get(name);
  if (!tensor) throw new TypeError(`Missing model tensor ${name}.`);
  if (shape && (tensor.spec.shape.length !== shape.length || tensor.spec.shape.some((size, index) => size !== shape[index]))) {
    throw new TypeError(`Tensor ${name} has shape ${tensor.spec.shape.join("x")}, expected ${shape.join("x")}.`);
  }
  return tensor.values;
}
