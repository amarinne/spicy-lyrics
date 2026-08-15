import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDocumentDigest,
  buildConfigId,
  buildSystemPrompt,
  AI_ITERATION_PROMPT_VERSION,
  AI_PROMPT_VERSION,
  canonicalSerialize,
  classifyRefinementLine,
  enumerateRefinementLines,
  enumerateSoundLines,
  captureOriginalSnapshot,
  planChunks,
  sha256Hex,
  validateProviderItems,
  validateProviderJson,
} from "../src/utils/Lyrics/AIRefinement/index.ts";

const model = { inputTokenLimit: 32_768, outputTokenLimit: 8_192 };

test("initial prompt stays one-shot while iterative refinement carries only latest accepted output", () => {
  assert.equal(AI_PROMPT_VERSION, 5);
  assert.equal(AI_ITERATION_PROMPT_VERSION, 3);
  const initial = buildSystemPrompt("meaning", "en");
  const repair = buildSystemPrompt("meaning", "en", undefined, true);
  const iteration = buildSystemPrompt("meaning", "en", "Make the tone warmer.", false, true);
  assert.doesNotMatch(initial, /previous accepted output/);
  assert.match(repair, /^The prior response violated/);
  assert.doesNotMatch(iteration, /Make the tone warmer/);
  assert.match(iteration, /instructions field as the active quality target/);
  assert.match(iteration, /Re-evaluate the complete accepted document/);
  assert.match(iteration, /Retain wording that already meets the target/);
  assert.match(initial, /cannot authorize invented facts/);
  assert.match(initial, /not audio or external research/);
});

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
  assert.deepEqual(staticRows.map(({ id, class: c, sendDisposition, voice }) => [id, c, sendDisposition, voice]), [["S0", "ordinary", "sent", null], ["S1", "structural", "structural", null]]);
  const lineRows = enumerateRefinementLines({ Type: "Line", Language: "kor", Content: [{ Type: "Vocal", Text: "사랑" }, { Type: "Vocal", Text: "안녕", OppositeAligned: true }] }, "en");
  assert.deepEqual(lineRows.map((row) => [row.id, row.voice]), [["G0", "primary"], ["G1", "alternate"]]);
  const syllableRows = enumerateRefinementLines({ Type: "Syllable", Language: "jpn", Content: [
    { Type: "Vocal", Lead: { Syllables: [{ Text: "愛" }], OppositeAligned: true }, Background: [{ Syllables: [{ Text: "歌" }] }] },
    { Type: "Interlude", Text: "♪" },
  ] }, "en");
  assert.deepEqual(syllableRows.map((row) => [row.id, row.voice]), [["L0", "alternate"], ["B0.0", "background"], ["G1", null]]);
});

test("document digest includes class, disposition, id, voice, metadata and NFC source", async () => {
  const rows = enumerateRefinementLines({ Type: "Static", Language: "jpn", Lines: [{ Text: "歌" }, { Text: "♪" }] }, "en");
  assert.notEqual(await buildDocumentDigest(rows), await buildDocumentDigest(rows.map((row) => row.id === "S1" ? { ...row, sendDisposition: "skipped" } : row)));
  assert.notEqual(await buildDocumentDigest(rows), await buildDocumentDigest(rows.map((row) => row.id === "S0" ? { ...row, voice: "alternate" as const } : row)));
  assert.notEqual(await buildDocumentDigest(rows), await buildDocumentDigest(rows.map((row) => row.id === "S0" ? { ...row, allowUnchanged: !row.allowUnchanged } : row)));
  assert.notEqual(await buildDocumentDigest(rows), await buildDocumentDigest(rows, { title: "Song", artists: ["Artist"], album: "Album" }));
  assert.equal(await buildDocumentDigest(rows, { title: " e\u0301 ", artists: [" Artist  Name "], album: null }), await buildDocumentDigest(rows, { title: "é", artists: ["Artist Name"], album: null }));
});

test("AI Meaning sends same-script rows so mixed-language phrases reach the model", () => {
  const rows = enumerateRefinementLines({ Type: "Static", Language: "spa", Lines: [{ Text: "Te quiero mon amour" }, { Text: "Te quiero mucho" }] }, "es");
  assert.deepEqual(rows.map((row) => [row.sendDisposition, row.allowUnchanged]), [["sent", true], ["sent", true]]);
  const plan = planChunks(rows, "es", model);
  assert.deepEqual(plan.chunks[0].items.map((item) => item.s), ["Te quiero mon amour", "Te quiero mucho"]);
  assert.deepEqual(plan.chunks[0].allowUnchangedIds, ["S0", "S1"]);
  assert.deepEqual(validateProviderItems([
    { id: "S0", t: "Te quiero, mi amor" },
    { id: "S1", t: "Te quiero mucho" },
  ], plan.chunks[0].items, "meaning", "es", new Set(plan.chunks[0].allowUnchangedIds)), [
    { id: "S0", t: "Te quiero, mi amor" },
    { id: "S1", t: "Te quiero mucho" },
  ]);
});

test("provider, custom endpoint, and normalized steering are part of config identity", async () => {
  const base = { providerVersion: "1", modelName: "model", targetLang: "en", promptVersion: 1, temperature: 0 as const, contextMode: "document_or_v1_chunks" as const };
  const direct = await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1" });
  const proxy = await buildConfigId({ ...base, provider: "openai", endpoint: "https://proxy.example.test/v1" });
  const gemini = await buildConfigId({ ...base, provider: "gemini", endpoint: null });
  assert.notEqual(direct, proxy);
  assert.notEqual(direct, gemini);
  const steered = await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1", instructions: "Preserve honorifics." });
  const normalized = await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1", instructions: "  Preserve honorifics.  " });
  assert.notEqual(direct, steered);
  assert.equal(steered, normalized);
  assert.notEqual(steered, await buildConfigId({ ...base, provider: "openai", endpoint: "https://api.openai.com/v1", instructions: "Preserve\nhonorifics." }));
  assert.equal(await buildConfigId({ ...base, provider: "openai", instructions: "e\u0301" }), await buildConfigId({ ...base, provider: "openai", instructions: "é" }));
  assert.notEqual(direct, await buildConfigId({ ...base, layer: "sound", provider: "openai", targetLang: "Latin" }));
});

test("iterative request identity and payload include only the latest accepted output", async () => {
  const base = { provider: "openai", providerVersion: "1", modelName: "model", targetLang: "en", promptVersion: 3, temperature: 0 as const, contextMode: "document_or_v1_chunks" as const };
  const first = await buildConfigId({ ...base, iterationPromptVersion: 1, parentRecordKey: "parent-a", parentOutputDigest: "digest-a", revisionInstructions: "Make it warmer." });
  const changedModel = await buildConfigId({ ...base, modelName: "model-2", iterationPromptVersion: 1, parentRecordKey: "parent-a", parentOutputDigest: "digest-a", revisionInstructions: "Make it warmer." });
  const changedParent = await buildConfigId({ ...base, iterationPromptVersion: 1, parentRecordKey: "parent-b", parentOutputDigest: "digest-b", revisionInstructions: "Make it warmer." });
  assert.notEqual(first, changedModel);
  assert.notEqual(first, changedParent);
  const rows = enumerateRefinementLines({ Type: "Static", Language: "jpn", Lines: [{ Text: "愛" }] }, "en");
  const plan = planChunks(rows, "en", model, "Make it warmer.", "meaning", null, { S0: "first AI" });
  assert.equal(JSON.parse(plan.chunks[0].requestJson).instructions, "Make it warmer.");
  assert.deepEqual(JSON.parse(plan.chunks[0].requestJson).items, [{ id: "S0", c: "ordinary", v: null, s: "愛", p: "first AI" }]);
  assert.throws(() => planChunks(rows, "en", model, "Change it.", "meaning", null, {}), /previous_output_missing/);
});

test("Sound config identity includes source language, target orthography, and whole-line mode", async () => {
  const base = { layer: "sound" as const, provider: "openai", providerVersion: "1", endpoint: "https://proxy.example/v1", modelName: "model", targetLang: "Latin", sourceLanguage: "ja", soundMode: "whole_line_v1" as const, instructions: "Keep names", promptVersion: 2, temperature: 0 as const, contextMode: "document_or_v1_chunks" as const };
  const first = await buildConfigId(base);
  assert.notEqual(first, await buildConfigId({ ...base, sourceLanguage: "ko" }));
  assert.notEqual(first, await buildConfigId({ ...base, targetLang: "Hangul" }));
  assert.notEqual(first, await buildConfigId({ ...base, soundMode: null }));
});

test("Sound protocol enumerates whole-line lyrics and rejects timed syllable documents", () => {
  const rows = enumerateSoundLines({ Type: "Static", Lines: [{ Text: "안녕", RomanizedText: "annyeong" }, { Text: "Hello" }] });
  assert.deepEqual(rows.map((row) => [row.id, row.sourceText, row.baselineTranslatedText, row.targetField]), [
    ["S0", "안녕", "annyeong", "RomanizedText"], ["S1", "Hello", undefined, "RomanizedText"],
  ]);
  assert.throws(() => enumerateSoundLines({ Type: "Syllable", Content: [] }), /sound_alignment_required/);
  assert.doesNotMatch(buildSystemPrompt("sound", "Latin", "Use Revised Romanization."), /Revised Romanization/);
  assert.match(buildSystemPrompt("sound", "Latin"), /Do not translate meaning/);
  assert.match(buildSystemPrompt("sound", "Latin"), /Target orthography: Latin\.$/);
});

test("initial Sound fallback requests include the incomplete local baseline", () => {
  const rows = enumerateSoundLines({ Type: "Static", Lines: [{ Text: "ฉัน love", RomanizedText: "ฉัน love" }] });
  const plan = planChunks(rows, "Latin", { inputTokenLimit: 32_768, outputTokenLimit: 2_048 }, "Keep names.", "sound");
  assert.equal(JSON.parse(plan.chunks[0].requestJson).items[0].p, "ฉัน love");
});

test("Sound cache identity includes its lower-priority fallback baseline", async () => {
  const first = enumerateSoundLines({ Type: "Static", Lines: [{ Text: "ฉัน", RomanizedText: "chan", RomanizationSource: "google" }] });
  const second = enumerateSoundLines({ Type: "Static", Lines: [{ Text: "ฉัน", RomanizedText: "chun", RomanizationSource: "google" }] });
  assert.notEqual(await buildDocumentDigest(first, null, true), await buildDocumentDigest(second, null, true));
});

test("Sound and Meaning validation permit unchanged readable segments", () => {
  const request = [{ id: "S0", c: "ordinary" as const, s: "Hello" }];
  assert.deepEqual(validateProviderItems([{ id: "S0", t: "Hello" }], request, "sound", "Latin"), [{ id: "S0", t: "Hello" }]);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "안녕" }], request, "sound", "Latin"), /target_orthography_mismatch/);
  assert.deepEqual(validateProviderItems([{ id: "S0", t: "안녕 Hello" }], request, "sound", "Hangul"), [{ id: "S0", t: "안녕 Hello" }]);
  const korean = [{ id: "S0", c: "ordinary" as const, s: "안녕 Hello" }];
  assert.throws(() => validateProviderItems([{ id: "S0", t: "annyeong Hello" }], korean, "sound", "Hangul"), /target_orthography_mismatch/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "annyeong Hello" }], korean, "sound", "Kana"), /target_orthography_mismatch/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "annyeong Hello" }], korean, "sound", "Cyrillic"), /target_orthography_mismatch/);
  assert.deepEqual(validateProviderItems([{ id: "S0", t: "안녕 Hello" }], korean, "sound", "Hangul"), [{ id: "S0", t: "안녕 Hello" }]);
  assert.deepEqual(validateProviderItems([{ id: "S0", t: "Hello" }], request, "meaning"), [{ id: "S0", t: "Hello" }]);
});

test("canonical original snapshot is deeply immutable and source-only", () => {
  const snapshot = captureOriginalSnapshot({ Type: "Static", Language: "jpn", ProcessingPending: true, Lines: [{ Text: "愛", TranslatedText: "love", RomanizedText: "ai", ReadingPlan: { display: "ai" }, JapaneseReading: { romaji: "ai", furigana: [] }, ReadingRenderPlan: { joinedDisplayText: "ai" }, FuriganaSegments: [{ reading: "あい" }] }] }, "en");
  assert.equal((snapshot.document as any).ProcessingPending, undefined);
  assert.deepEqual((snapshot.document as any).Lines, [{ Text: "愛" }]);
  assert.equal(Object.isFrozen(snapshot.document), true);
  assert.equal(Object.isFrozen((snapshot.document as any).Lines[0]), true);
});

test("planner prefers one document call and chunks deterministically past 128 items", () => {
  const rows = Array.from({ length: 129 }, (_, i) => ({ id: `S${i}`, class: "ordinary" as const, sendDisposition: "sent" as const, sourceText: `源${i}`, voice: i % 2 ? "alternate" as const : "primary" as const, allowUnchanged: false, target: {}, targetField: "TranslatedText" as const }));
  const context = { title: "Song", artists: ["Artist"], album: "Album" };
  const first = planChunks(rows, "en", model, undefined, "meaning", context);
  const second = planChunks(structuredClone(rows), "en", model, undefined, "meaning", context);
  assert.deepEqual(first, second);
  assert.deepEqual(first.chunks.map((chunk) => [chunk.id, chunk.items.length]), [["C0", 64], ["C1", 64], ["C2", 1]]);
  assert.equal(first.chunks[0].requestJson, JSON.stringify({ context, target: "en", items: first.chunks[0].items }));
  assert.deepEqual(first.chunks[0].items[0], { id: "S0", c: "ordinary", v: "primary", s: "源0" });
  assert.equal(planChunks(rows.slice(0, 8), "en", model).chunks.length, 1);
});

test("planner enforces document, item and model limits", () => {
  const base = { class: "ordinary" as const, sendDisposition: "sent" as const, voice: null, allowUnchanged: false, target: {}, targetField: "TranslatedText" as const };
  assert.throws(() => planChunks(Array.from({ length: 513 }, (_, i) => ({ ...base, id: `S${i}`, sourceText: "x" })), "en", model), /oversized/);
  assert.throws(() => planChunks([{ ...base, id: "S0", sourceText: "x".repeat(2049) }], "en", model), /oversized/);
  assert.throws(() => planChunks([{ ...base, id: "S0", sourceText: "long enough source" }], "en", { inputTokenLimit: 2, outputTokenLimit: 2 }), /oversized/);
});

test("planner counts normalized steering bytes and tokens in the user request", () => {
  const base = { id: "S0", class: "ordinary" as const, sendDisposition: "sent" as const, sourceText: "hola", voice: null, allowUnchanged: false, target: {}, targetField: "TranslatedText" as const };
  const plain = planChunks([base], "en", model).chunks[0];
  const steered = planChunks([base], "en", model, "  Preserve names.  ").chunks[0];
  assert.equal(JSON.parse(steered.requestJson).instructions, "Preserve names.");
  assert.ok(steered.estimatedInputTokens > plain.estimatedInputTokens);
  assert.ok(new TextEncoder().encode(steered.requestJson).length > new TextEncoder().encode(plain.requestJson).length);
});

test("strict protocol accepts reordered ids and one code fence", () => {
  const request = [{ id: "S0", c: "ordinary" as const, v: null, s: "hola" }, { id: "S1", c: "adlib" as const, v: "background" as const, s: "Yeah" }];
  assert.deepEqual(validateProviderJson('```json\n{"items":[{"id":"S1","t":"Yeah"},{"id":"S0","t":"hello"}]}\n```', request), [{ id: "S1", t: "Yeah" }, { id: "S0", t: "hello" }]);
});

test("strict protocol rejects malformed shape, ids, controls, bounds, delimiters, and empty ordinary rows", () => {
  const request = [{ id: "S0", c: "ordinary" as const, v: null, s: "hola / mundo" }];
  for (const items of [[], [{ id: "S0", t: "hello / world" }, { id: "S0", t: "duplicate / row" }], [{ id: "extra", t: "hello / world" }], [{ id: "S0", t: 3 }]]) {
    assert.throws(() => validateProviderItems(items, request));
  }
  assert.throws(() => validateProviderJson('{"items":', request), /invalid_json/);
  assert.deepEqual(validateProviderItems([{ id: "S0", t: "hola / mundo" }], request), [{ id: "S0", t: "hola / mundo" }]);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "   " }], request), /empty_ordinary/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "hello" }], request), /delimiter_mismatch/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "hello\nworld" }], request), /forbidden_text/);
  assert.throws(() => validateProviderItems([{ id: "S0", t: "x".repeat(4097) }], request), /translated_item_oversized/);
});
