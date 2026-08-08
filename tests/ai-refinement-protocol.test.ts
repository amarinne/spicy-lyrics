import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDocumentDigest,
  buildConfigId,
  canonicalSerialize,
  classifyRefinementLine,
  enumerateRefinementLines,
  captureOriginalSnapshot,
  planChunks,
  sha256Hex,
  validateProviderItems,
  validateProviderJson,
} from "../src/utils/Lyrics/AIRefinement/index.ts";

const model = { inputTokenLimit: 32_768, outputTokenLimit: 8_192 };

test("canonical identity sorts keys, normalizes NFC, hashes to lowercase SHA-256", async () => {
  assert.equal(canonicalSerialize({ b: "e\u0301", a: [2, null] }), '{"a":[2,null],"b":"é"}');
  const left = await sha256Hex({ b: "e\u0301", a: [2, null] });
  const right = await sha256Hex({ a: [2, null], b: "é" });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
  assert.throws(() => canonicalSerialize({ value: undefined }), /undefined is forbidden/);
});

test("classification v1 is narrow", () => {
  for (const value of ["", "♪", "[Chorus]", "[VERSE 2]", "[ pre-chorus ]"]) assert.equal(classifyRefinementLine(value), "structural");
  for (const value of ["Yeah", "la la la", "Oh, oh!", "woah yeah"]) assert.equal(classifyRefinementLine(value), "adlib");
  for (const value of ["[Producer]", "Alice", "yeah forever", "I'm sorry"]) assert.equal(classifyRefinementLine(value), "ordinary");
});

test("enumerates every shape with stable lead/background and structural ids", () => {
  const staticRows = enumerateRefinementLines({ Type: "Static", Language: "jpn", Lines: [{ Text: "歌", TranslatedText: "song" }, { Text: "♪" }] }, "en");
  assert.deepEqual(staticRows.map(({ id, class: c, sendDisposition }) => [id, c, sendDisposition]), [["S0", "ordinary", "sent"], ["S1", "structural", "structural"]]);
  const lineRows = enumerateRefinementLines({ Type: "Line", Language: "kor", Content: [{ Type: "Vocal", Text: "사랑" }, { Type: "Interlude", Text: "" }] }, "en");
  assert.deepEqual(lineRows.map((row) => row.id), ["G0", "G1"]);
  const syllableRows = enumerateRefinementLines({ Type: "Syllable", Language: "jpn", Content: [
    { Type: "Vocal", Lead: { Syllables: [{ Text: "愛" }] }, Background: [{ Syllables: [{ Text: "歌" }] }] },
    { Type: "Interlude", Text: "♪" },
  ] }, "en");
  assert.deepEqual(syllableRows.map((row) => row.id), ["L0", "B0.0", "G1"]);
});

test("document digest includes class, disposition, id and NFC source", async () => {
  const rows = enumerateRefinementLines({ Type: "Static", Language: "jpn", Lines: [{ Text: "歌" }, { Text: "♪" }] }, "en");
  assert.notEqual(await buildDocumentDigest(rows), await buildDocumentDigest(rows.map((row) => row.id === "S1" ? { ...row, sendDisposition: "skipped" } : row)));
});

test("provider, custom endpoint, and normalized steering are part of config identity", async () => {
  const base = { providerVersion: "1", modelName: "model", targetLang: "en", promptVersion: 1, temperature: 0 as const, contextMode: "document_or_v1_chunks" as const };
  const direct = await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1" });
  const proxy = await buildConfigId({ ...base, provider: "openai", endpoint: "https://proxy.example.test/v1" });
  const gemini = await buildConfigId({ ...base, provider: "gemini", endpoint: null });
  assert.notEqual(direct, proxy);
  assert.notEqual(direct, gemini);
  const steered = await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1", instructions: "Preserve honorifics." });
  const normalized = await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1", instructions: "  Preserve   honorifics.  " });
  assert.notEqual(direct, steered);
  assert.equal(steered, normalized);
  assert.equal(await buildConfigId({ ...base, provider: "openai", instructions: "e\u0301" }), await buildConfigId({ ...base, provider: "openai", instructions: "é" }));
});

test("canonical original snapshot is deeply immutable and source-only", () => {
  const snapshot = captureOriginalSnapshot({ Type: "Static", Language: "jpn", ProcessingPending: true, Lines: [{ Text: "愛", TranslatedText: "love", RomanizedText: "ai", ReadingPlan: { display: "ai" }, JapaneseReading: { romaji: "ai", furigana: [] }, ReadingRenderPlan: { joinedDisplayText: "ai" }, FuriganaSegments: [{ reading: "あい" }] }] }, "en");
  assert.equal((snapshot.document as any).ProcessingPending, undefined);
  assert.deepEqual((snapshot.document as any).Lines, [{ Text: "愛" }]);
  assert.equal(Object.isFrozen(snapshot.document), true);
  assert.equal(Object.isFrozen((snapshot.document as any).Lines[0]), true);
});

test("planner prefers one document call and chunks deterministically past 128 items", () => {
  const rows = Array.from({ length: 129 }, (_, i) => ({ id: `S${i}`, class: "ordinary" as const, sendDisposition: "sent" as const, sourceText: `源${i}`, target: {}, targetField: "TranslatedText" as const }));
  const first = planChunks(rows, "en", model);
  const second = planChunks(structuredClone(rows), "en", model);
  assert.deepEqual(first, second);
  assert.deepEqual(first.chunks.map((chunk) => [chunk.id, chunk.items.length]), [["C0", 64], ["C1", 64], ["C2", 1]]);
  assert.equal(first.chunks[0].requestJson, JSON.stringify({ target: "en", items: first.chunks[0].items }));
  assert.equal(planChunks(rows.slice(0, 8), "en", model).chunks.length, 1);
});

test("planner enforces document, item and model limits", () => {
  const base = { class: "ordinary" as const, sendDisposition: "sent" as const, target: {}, targetField: "TranslatedText" as const };
  assert.throws(() => planChunks(Array.from({ length: 513 }, (_, i) => ({ ...base, id: `S${i}`, sourceText: "x" })), "en", model), /oversized/);
  assert.throws(() => planChunks([{ ...base, id: "S0", sourceText: "x".repeat(2049) }], "en", model), /oversized/);
  assert.throws(() => planChunks([{ ...base, id: "S0", sourceText: "long enough source" }], "en", { inputTokenLimit: 2, outputTokenLimit: 2 }), /oversized/);
});

test("strict protocol accepts reordered ids and one code fence", () => {
  const request = [{ id: "S0", c: "ordinary" as const, s: "hola" }, { id: "S1", c: "adlib" as const, s: "Yeah" }];
  assert.deepEqual(validateProviderJson('```json\n{"items":[{"id":"S1","t":"Yeah"},{"id":"S0","t":"hello"}]}\n```', request), [{ id: "S1", t: "Yeah" }, { id: "S0", t: "hello" }]);
});

test("strict protocol rejects malformed shape, ids, controls, bounds and unchanged ordinary", () => {
  const request = [{ id: "S0", c: "ordinary" as const, s: "hola / mundo" }];
  for (const items of [[], [{ id: "S0", t: "hello / world" }, { id: "S0", t: "duplicate / row" }], [{ id: "extra", t: "hello / world" }], [{ id: "S0", t: 3 }]]) {
    assert.throws(() => validateProviderItems(items, request));
  }
  assert.throws(() => validateProviderJson('{"items":', request), /invalid_json/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "hola / mundo" }], request), /unchanged_ordinary/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "hello" }], request), /delimiter_mismatch/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "hello\nworld" }], request), /forbidden_text/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "x".repeat(4097) }], request), /translated_item_oversized/);
});
