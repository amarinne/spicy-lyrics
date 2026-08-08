import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOpenAIBaseUrl, OpenAIRefinementProvider } from "../src/utils/Lyrics/AIRefinement/OpenAIProvider.ts";
import { captureProviderBaseline, captureProviderExchange, clearProviderCapture, getActiveProviderCaptureId, getProviderCaptureState, getProviderComparisonRows } from "../src/utils/Lyrics/AIRefinement/DebugCapture.ts";

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
      usage: { prompt_tokens: 17, completion_tokens: 9 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const model = { name: "gemini-2.5-flash", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  const result = await provider.translateChunk({ target: "en", items: [{ id: "S0", c: "ordinary", s: "hola" }] }, {
    providerVersion: "openai-compatible-v1", endpoint: "https://proxy.example.test/v1", model, targetLang: "en", promptVersion: 1, temperature: 0, contextMode: "document_or_v1_chunks", credential: { secret: "private-key" }, repair: false, maxOutputTokens: 64,
  }, new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.items, [{ id: "S0", t: "hello" }]);
  assert.deepEqual(result.usage, { input: 17, output: 9 });
  assert.equal(result.finish, "stop");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(calls[0].url, "https://proxy.example.test/v1/chat/completions");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer private-key");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 64);
  assert.deepEqual(JSON.parse(body.messages[1].content), { target: "en", items: [{ id: "S0", c: "ordinary", s: "hola" }] });
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
  captureProviderBaseline("spotify:track:test", "Test — Artist", [{ id: "S0", baselineTranslatedText: "baseline hello" }]);
  const provider = new OpenAIRefinementProvider("https://proxy.example.test/v1", async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[{"id":"S0","t":"hello"}]}' }, finish_reason: "stop" }] }), { status: 200 }));
  const model = { name: "model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 8_192, supportedGenerationMethods: ["chat.completions"] };
  await provider.translateChunk({ target: "en", items: [{ id: "S0", c: "ordinary", s: "private source" }] }, { providerVersion: "1", endpoint: "https://proxy.example.test/v1", model, targetLang: "en", promptVersion: 1, temperature: 0, contextMode: "document_or_v1_chunks", credential: { secret: "private-key" }, repair: false, maxOutputTokens: 64 }, new AbortController().signal);
  const state = getProviderCaptureState();
  assert.equal(state.exchanges.length, 1);
  const serialized = JSON.stringify(state.exchanges[0]);
  assert.match(serialized, /private source/);
  assert.match(serialized, /hello/);
  assert.doesNotMatch(serialized, /private-key|Authorization|headers/i);
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", baseline: "baseline hello", ai: "hello" }]);
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
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", baseline: "second baseline", ai: "" }]);
  clearProviderCapture();
});

test("late exchange cannot cross from an old song into the newly active capture", () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:first", "First — Artist", [{ id: "S0", baselineTranslatedText: "first baseline" }]);
  const firstCaptureId = getActiveProviderCaptureId();
  captureProviderBaseline("spotify:track:second", "Second — Artist", [{ id: "S0", baselineTranslatedText: "second baseline" }]);

  captureProviderExchange(firstCaptureId, { schema: 1, capturedAt: new Date(0).toISOString(), providerId: "openai", endpoint: "https://proxy.example.test/v1", model: "model-a", repair: false, status: 200, request: { song: "first" }, response: { choices: [{ message: { content: '{"items":[{"id":"S0","t":"late first AI"}]}' } }] } });
  assert.equal(getProviderCaptureState().exchanges.length, 0);
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", baseline: "second baseline", ai: "" }]);
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
