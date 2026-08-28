import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOpenAIBaseUrl, OpenAIRefinementProvider } from "../src/utils/Lyrics/AIRefinement/OpenAIProvider.ts";
import { buildCurrentProviderComparisonRows, buildProviderComparisonRows, captureProviderAcceptedItems, captureProviderBaseline, captureProviderExchange, clearProviderCapture, finishProviderCapture, getActiveProviderCaptureId, getProviderCaptureMetadata, getProviderCaptureState, getProviderComparisonRows, providerCaptureFilename, selectCurrentComparisonCaptures } from "../src/utils/Lyrics/AIRefinement/DebugCapture.ts";
import { EMPTY_LYRIC_CONTEXT } from "../src/utils/Lyrics/AIRefinement/protocol.ts";

const lyricContext = { title: "Song", artists: ["Artist"], album: "Album" };

test("OpenAI-compatible discovery uses bearer auth and a custom base URL without putting the key in the URL", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new OpenAIRefinementProvider("https://proxy.example.test/v1/", async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ data: [
      { id: "gemini-2.5-flash", owned_by: "cliproxy" },
      { id: "text-embedding-3-small", owned_by: "openai" },
    ] }), { status: 200 });
  });
  const result = await provider.listModels({ secret: "private-key" }, new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.models.map((model) => model.name), ["gemini-2.5-flash"]);
  assert.equal(calls[0].url, "https://proxy.example.test/v1/models");
  assert.doesNotMatch(calls[0].url, /private-key/);
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer private-key");
  assert.equal(calls[0].init?.credentials, "omit");
  assert.equal(calls[0].init?.cache, "no-store");
});

test("OpenAI-compatible discovery maps failures without reading provider bodies", async () => {
  for (const [status, kind] of [[401, "auth"], [403, "auth"], [429, "rate_limited"], [500, "delivery_unknown"], [400, "request_rejected"]] as const) {
    const provider = new OpenAIRefinementProvider("https://api.openai.com/v1", async () => new Response("sensitive body", { status }));
    const result = await provider.listModels({ secret: "key" }, new AbortController().signal);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, kind);
  }
});

test("custom endpoint normalization rejects embedded credentials, query strings, fragments, and non-http schemes", () => {
  assert.equal(normalizeOpenAIBaseUrl("https://proxy.example.test/v1/"), "https://proxy.example.test/v1");
  assert.equal(normalizeOpenAIBaseUrl("http://127.0.0.1:8317/v1"), "http://127.0.0.1:8317/v1");
  for (const value of ["http://proxy.example.test/v1", "file:///tmp/api", "https://user:pass@example.test/v1", "https://example.test/v1?key=x", "https://example.test/v1#x"]) {
    assert.throws(() => normalizeOpenAIBaseUrl(value), /invalid_endpoint/);
  }
});

test("OpenAI-compatible translation uses the structured contract and maps usage", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new OpenAIRefinementProvider("https://proxy.example.test/v1", async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"items":[{"id":"S0","t":"hello"}]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 37, completion_tokens_details: { reasoning_tokens: 11 } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const model = { name: "gemini-2.5-flash", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  const result = await provider.translateChunk({ context: lyricContext, target: "en", instructions: "Preserve honorifics.", items: [{ id: "S0", c: "ordinary", v: "primary", s: "hola" }] }, {
    providerVersion: "openai-compatible-v1", endpoint: "https://proxy.example.test/v1", model, targetLang: "en", instructions: "Preserve honorifics.", context: lyricContext, promptVersion: 3, temperature: 0, contextMode: "document_or_v1_chunks", credential: { secret: "private-key" }, repair: false, maxOutputTokens: 64,
  }, new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.items, [{ id: "S0", t: "hello" }]);
  assert.deepEqual(result.usage, { input: 17, output: 20 });
  assert.equal(result.finish, "stop");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(calls[0].url, "https://proxy.example.test/v1/chat/completions");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer private-key");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 64);
  assert.deepEqual(JSON.parse(body.messages[1].content), { context: lyricContext, target: "en", instructions: "Preserve honorifics.", items: [{ id: "S0", c: "ordinary", v: "primary", s: "hola" }] });
  assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ["system", "user"]);
  assert.equal(body.messages.some((message: { role: string }) => message.role === "assistant"), false);
  assert.doesNotMatch(body.messages[0].content, /Preserve honorifics/);
  assert.match(body.messages[0].content, /A row may remain unchanged/);
});

test("model probe uses the translation transport and rejects malformed output", async () => {
  const model = { name: "model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  const good = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"P0","t":"hello"}]}' }, finish_reason: "stop" }] }), { status: 200 }));
  assert.equal((await good.probeModel(model, { secret: "key" }, new AbortController().signal)).ok, true);
  const bad = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" }, finish_reason: "stop" }] }), { status: 200 }));
  const result = await bad.probeModel(model, { secret: "key" }, new AbortController().signal);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, "protocol");
});

test("OpenAI-compatible transport accepts parsed JSON content and classifies empty refusal before parsing", async () => {
  const model = { name: "model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  const parsed = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: { items: [{ id: "S0", t: "hello" }] } }, finish_reason: "stop" }] }), { status: 200 }));
  const request = { context: EMPTY_LYRIC_CONTEXT, target: "en", items: [{ id: "S0", c: "ordinary" as const, v: null, s: "hola" }] };
  const providerConfig = { providerVersion: "1", model, targetLang: "en", context: EMPTY_LYRIC_CONTEXT, promptVersion: 4, temperature: 0 as const, contextMode: "document_or_v1_chunks" as const, credential: { secret: "private-key" }, repair: false, maxOutputTokens: 64 };
  const parsedResult = await parsed.translateChunk(request, providerConfig, new AbortController().signal);
  assert.equal(parsedResult.ok, true);
  if (parsedResult.ok) assert.deepEqual(parsedResult.items, [{ id: "S0", t: "hello" }]);

  const refused = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "blocked" }, finish_reason: "content_filter" }] }), { status: 200 }));
  const refusedResult = await refused.translateChunk(request, providerConfig, new AbortController().signal);
  assert.equal(refusedResult.ok, true);
  if (refusedResult.ok) assert.equal(refusedResult.finish, "safety");
});

test("model probes never enter an enabled real-song request capture", async () => {
  clearProviderCapture();
  const model = { name: "model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  const provider = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"P0","t":"hello"}]}' }, finish_reason: "stop" }] }), { status: 200 }));
  assert.equal((await provider.probeModel(model, { secret: "key" }, new AbortController().signal)).ok, true);
  assert.equal(getProviderCaptureState().exchanges.length, 0);
  clearProviderCapture();
});

test("explicit debug capture keeps payloads and raw responses in memory without credentials or headers", async () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:test", "Test — Artist", [{ id: "S0", baselineTranslatedText: "baseline hello" }], "meaning", { provider: "spotify", label: "Spotify", format: "Line" });
  const provider = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"S0","t":"hello"}]}' }, finish_reason: "stop" }] }), { status: 200 }));
  const model = { name: "model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  await provider.translateChunk({ context: EMPTY_LYRIC_CONTEXT, target: "en", items: [{ id: "S0", c: "ordinary", v: null, s: "private source" }] }, { providerVersion: "1", endpoint: "https://proxy.example.test/v1", model, targetLang: "en", context: EMPTY_LYRIC_CONTEXT, promptVersion: 3, temperature: 0, contextMode: "document_or_v1_chunks", credential: { secret: "private-key" }, repair: false, maxOutputTokens: 64, captureId: getActiveProviderCaptureId() }, new AbortController().signal);
  captureProviderAcceptedItems(getActiveProviderCaptureId(), [{ id: "S0", t: "hello" }]);
  const state = getProviderCaptureState();
  assert.equal(state.exchanges.length, 1);
  const serialized = JSON.stringify(state.exchanges[0]);
  assert.match(serialized, /private source/);
  assert.match(serialized, /hello/);
  assert.doesNotMatch(serialized, /private-key|Authorization|headers/i);
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", original: "private source", baseline: "baseline hello", attempts: [{ number: 1, text: "hello", model: "model", repair: false, accepted: true }] }]);
  assert.deepEqual(getProviderCaptureMetadata()?.source, { provider: "spotify", label: "Spotify", format: "Line" });
  clearProviderCapture();
});

test("capture rolls to a new durable record when refinement moves to another song", () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:first", "First — Artist", [{ id: "S0", baselineTranslatedText: "first baseline" }]);
  captureProviderExchange(getActiveProviderCaptureId(), { schema: 1, capturedAt: new Date(0).toISOString(), providerId: "openai", endpoint: "https://proxy.example.test/v1", model: "model-a", repair: false, status: 200, request: {}, response: { choices: [{ message: { content: '{"items":[{"id":"S0","t":"first AI"}]}' } }] } });
  const firstId = getProviderCaptureState().captureId;

  captureProviderBaseline("spotify:track:second", "Second — Artist", [{ id: "S0", baselineTranslatedText: "second baseline" }]);
  const second = getProviderCaptureState();
  assert.notEqual(second.captureId, firstId);
  assert.equal(second.enabled, true);
  assert.equal(second.exchanges.length, 0);
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", original: "", baseline: "second baseline", attempts: [] }]);
  clearProviderCapture();
});

test("capture preserves every paid exchange but comparison shows one final version per run", () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:long", "Long Track", [
    { id: "S0", baselineTranslatedText: "zero" }, { id: "S1", baselineTranslatedText: "one" },
  ]);
  const captureId = getActiveProviderCaptureId();
  for (let index = 0; index < 6; index++) captureProviderExchange(captureId, {
    schema: 1, capturedAt: new Date(index).toISOString(), providerId: "openai", endpoint: "https://proxy.example.test/v1", model: "model-a", repair: index > 1, status: 200, request: {},
    response: { choices: [{ message: { content: JSON.stringify({ items: [{ id: index % 2 ? "S1" : "S0", t: `AI ${index}` }] }) } }] },
  });
  captureProviderAcceptedItems(captureId, [{ id: "S0", t: "AI 4" }, { id: "S1", t: "AI 5" }]);
  assert.equal(getProviderCaptureState().exchanges.length, 6);
  assert.deepEqual(getProviderComparisonRows(), [
    { id: "S0", original: "", baseline: "zero", attempts: [{ number: 1, text: "AI 4", model: "model-a", repair: true, accepted: true }] },
    { id: "S1", original: "", baseline: "one", attempts: [{ number: 1, text: "AI 5", model: "model-a", repair: true, accepted: true }] },
  ]);
  clearProviderCapture();
});

test("same-song refinement runs compare original, first machine baseline, and each accepted AI version", () => {
  const request = (source: string) => ({ messages: [{ role: "user", content: JSON.stringify({ items: [{ id: "S0", c: "ordinary", v: null, s: source }] }) }] });
  const response = (text: string) => ({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "S0", t: text }] }) } }] });
  const first = { id: "one", schema: 1 as const, createdAt: 1, updatedAt: 1, enabled: false, trackUri: "spotify:track:test", trackLabel: "Track", layer: "meaning" as const, baseline: [{ id: "S0", baseline: "machine" }], accepted: { S0: "first AI" }, exchanges: [{ schema: 1 as const, capturedAt: new Date(1).toISOString(), providerId: "openai", endpoint: "https://proxy", model: "model-a", repair: false, status: 200, request: request("original"), response: response("first AI") }] };
  const second = { ...first, id: "two", createdAt: 2, updatedAt: 2, baseline: [{ id: "S0", baseline: "first AI" }], accepted: { S0: "second AI" }, exchanges: [{ ...first.exchanges[0], capturedAt: new Date(2).toISOString(), model: "model-b", request: request("original"), response: response("second AI") }] };
  assert.deepEqual(buildProviderComparisonRows([first, second]), [{
    id: "S0", original: "original", baseline: "machine", attempts: [
      { number: 1, text: "first AI", model: "model-a", repair: false, accepted: true },
      { number: 2, text: "second AI", model: "model-b", repair: false, accepted: true },
    ],
  }]);
});

test("Sound comparison keeps Korean format history but isolates Chinese pronunciation systems", () => {
  const request = (source: string) => ({ messages: [{ role: "user", content: JSON.stringify({ items: [{ id: "G0", c: "ordinary", v: "primary", s: source }] }) }] });
  const response = (text: string) => ({ choices: [{ message: { content: JSON.stringify({ items: [{ id: "G0", t: text }] }) } }] });
  const capture = (id: string, baseline: string, accepted: string, createdAt: number, pronunciationSystem = "mandarin-pinyin") => ({
    id, schema: 1 as const, createdAt, updatedAt: createdAt, enabled: false, trackUri: "spotify:track:test", trackLabel: "Track", layer: "sound" as const,
    pronunciationSystem, source: { provider: "spotify", label: "Spotify", format: "Line" as const }, baseline: [{ id: "G0", baseline }], accepted: { G0: accepted },
    exchanges: [{ schema: 1 as const, capturedAt: new Date(createdAt).toISOString(), providerId: "openai", endpoint: "https://proxy", model: "model", repair: false, status: 200, request: request("한글"), response: response(accepted) }],
  });
  const oldFormat = capture("old", "han-geul", "hangeul", 1);
  const currentRows = [{ id: "G0", original: "한글", baseline: "han-geul-eul" }];
  assert.deepEqual(selectCurrentComparisonCaptures([oldFormat], { currentRows }).map((item) => item.id), ["old"]);
  assert.deepEqual(buildCurrentProviderComparisonRows([oldFormat], currentRows), [{
    id: "G0", original: "한글", baseline: "han-geul-eul", attempts: [{ number: 1, text: "hangeul", model: "model", repair: false, accepted: true }],
  }]);
  assert.deepEqual(selectCurrentComparisonCaptures([oldFormat], { currentRows, requireBaselineMatch: true, pronunciationSystem: "mandarin-pinyin" }), []);

  const currentSystem = capture("current", "han-geul-eul", "hangeureul", 2);
  const interleavedOtherSystem = capture("other-system", "hangeureul", "jyutping-ai", 3, "cantonese-jyutping");
  const revision = capture("revision", "hangeureul", "han-geu-reul", 4);
  assert.deepEqual(selectCurrentComparisonCaptures([oldFormat, currentSystem, interleavedOtherSystem, revision], { currentRows, requireBaselineMatch: true, pronunciationSystem: "mandarin-pinyin" }).map((item) => item.id), ["current", "revision"]);
});

test("capture export filename includes sanitized song, artist, and model", () => {
  assert.equal(providerCaptureFilename({
    id: "capture", schema: 1, createdAt: 0, updatedAt: 0, enabled: false, trackUri: "spotify:track:test", trackLabel: "Seigi — frederic", layer: "meaning", baseline: [], exchanges: [
      { schema: 1, capturedAt: new Date(0).toISOString(), providerId: "openai", endpoint: "https://proxy", model: "gemini-3.6-flash-high", repair: false, status: 200, request: {}, response: {} },
    ],
  }), "spicy-ai-capture-Seigi-frederic-gemini-3.6-flash-high-1970-01-01T00-00-00-000Z.json");
});

test("bounded non-2xx response bodies remain private but inspectable in capture", async () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:test", "Track", [{ id: "S0", baselineTranslatedText: "baseline" }]);
  const provider = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ error: { message: "model rejected request" } }), { status: 400 }));
  const model = { name: "model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  const result = await provider.translateChunk({ context: EMPTY_LYRIC_CONTEXT, target: "en", items: [{ id: "S0", c: "ordinary", v: null, s: "source" }] }, { providerVersion: "1", model, targetLang: "en", context: EMPTY_LYRIC_CONTEXT, promptVersion: 3, temperature: 0, contextMode: "document_or_v1_chunks", credential: { secret: "private-key" }, repair: false, maxOutputTokens: 64, captureId: getActiveProviderCaptureId() }, new AbortController().signal);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(getProviderCaptureState().exchanges[0].response), /model rejected request/);
  assert.doesNotMatch(JSON.stringify(getProviderCaptureState()), /private-key|authorization/i);
  clearProviderCapture();
});

test("late exchange cannot cross from an old song into the newly active capture", () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:first", "First — Artist", [{ id: "S0", baselineTranslatedText: "first baseline" }]);
  const firstCaptureId = getActiveProviderCaptureId();
  captureProviderBaseline("spotify:track:second", "Second — Artist", [{ id: "S0", baselineTranslatedText: "second baseline" }]);

  captureProviderExchange(firstCaptureId, { schema: 1, capturedAt: new Date(0).toISOString(), providerId: "openai", endpoint: "https://proxy.example.test/v1", model: "model-a", repair: false, status: 200, request: { song: "first" }, response: { choices: [{ message: { content: '{"items":[{"id":"S0","t":"late first AI"}]}' } }] } });
  assert.equal(getProviderCaptureState().exchanges.length, 0);
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", original: "", baseline: "second baseline", attempts: [] }]);
  clearProviderCapture();
});

test("Meaning and Sound captures remain independently active", () => {
  clearProviderCapture();
  const meaning = captureProviderBaseline("spotify:track:test", "Track", [{ id: "S0", baselineTranslatedText: "love" }], "meaning");
  const sound = captureProviderBaseline("spotify:track:test", "Track", [{ id: "S0", baselineTranslatedText: "sarang" }], "sound");
  assert.notEqual(meaning, sound);
  assert.equal(getActiveProviderCaptureId(), sound);
  captureProviderExchange(sound, { schema: 1, capturedAt: new Date(0).toISOString(), providerId: "openai", endpoint: "https://proxy.example.test/v1", model: "sound-model", repair: false, status: 200, request: {}, response: {} });
  assert.equal(getProviderCaptureState().exchanges.length, 1);
  finishProviderCapture(meaning);
  assert.equal(getActiveProviderCaptureId(), sound);
  finishProviderCapture(sound);
  assert.equal(getActiveProviderCaptureId(), null);
  clearProviderCapture();
});

test("provider sources never use the header-logging Query helper", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const name of ["GeminiProvider.ts", "OpenAIProvider.ts", "ProviderTransport.ts"]) {
    const source = await readFile(new URL(`../src/utils/Lyrics/AIRefinement/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /API\/Query|\bQuery\(/);
    assert.doesNotMatch(source, /CosmosAsync/);
  }
});
