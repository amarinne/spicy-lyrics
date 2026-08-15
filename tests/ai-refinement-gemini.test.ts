import assert from "node:assert/strict";
import { test } from "node:test";
import { captureProviderAcceptedItems, captureProviderBaseline, clearProviderCapture, getActiveProviderCaptureId, getProviderCaptureMetadata, getProviderComparisonRows } from "../src/utils/Lyrics/AIRefinement/DebugCapture.ts";
import { GeminiRefinementProvider } from "../src/utils/Lyrics/AIRefinement/GeminiProvider.ts";
import { EMPTY_LYRIC_CONTEXT } from "../src/utils/Lyrics/AIRefinement/protocol.ts";

const descriptor = (name: string, methods = ["generateContent"]) => ({
  name,
  version: "1",
  inputTokenLimit: 32_768,
  outputTokenLimit: 8_192,
  supportedGenerationMethods: methods,
});

test("Gemini discovery paginates with a header-only key and filters incompatible models", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new GeminiRefinementProvider(async (input, init) => {
    requests.push({ url: String(input), init });
    const second = String(input).includes("pageToken=next");
    return new Response(JSON.stringify(second ? {
      models: [descriptor("models/gemini-3.1-flash-lite")],
    } : {
      models: [
        descriptor("models/gemini-2.5-flash"),
        descriptor("models/text-embedding-004"),
        descriptor("models/gemini-image"),
        descriptor("models/gemini-no-generate", ["countTokens"]),
      ],
      nextPageToken: "next",
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await provider.listModels({ secret: "private-key" }, new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.models.map((model) => model.name), ["models/gemini-3.1-flash-lite", "models/gemini-2.5-flash"]);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.doesNotMatch(request.url, /private-key|key=/);
    assert.equal(new Headers(request.init?.headers).get("x-goog-api-key"), "private-key");
  }
});

test("Gemini discovery maps authentication and server failures with bounded bodies", async () => {
  for (const [status, kind] of [[401, "auth"], [403, "auth"], [429, "rate_limited"], [500, "delivery_unknown"], [400, "request_rejected"]] as const) {
    const provider = new GeminiRefinementProvider(async () => new Response("sensitive provider body", { status }));
    const result = await provider.listModels({ secret: "key" }, new AbortController().signal);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, kind);
  }
});

test("Gemini discovery rejects page and descriptor cap overflow", async () => {
  let pages = 0;
  const pageCapped = new GeminiRefinementProvider(async () => {
    pages++;
    return new Response(JSON.stringify({ models: [], nextPageToken: `page-${pages}` }), { status: 200 });
  });
  const pageResult = await pageCapped.listModels({ secret: "key" }, new AbortController().signal);
  assert.equal(pageResult.ok, false);
  if (!pageResult.ok) assert.equal(pageResult.failure.kind, "protocol");
  assert.equal(pages, 10);

  const modelCapped = new GeminiRefinementProvider(async () => new Response(JSON.stringify({ models: Array.from({ length: 501 }, (_, index) => descriptor(`models/gemini-${index}`)) }), { status: 200 }));
  const modelResult = await modelCapped.listModels({ secret: "key" }, new AbortController().signal);
  assert.equal(modelResult.ok, false);
  if (!modelResult.ok) assert.equal(modelResult.failure.kind, "protocol");
});

test("Gemini translation uses header auth, structured JSON, usage, and selected model", async () => {
  clearProviderCapture();
  captureProviderBaseline("spotify:track:test", "Track", [{ id: "S0", baselineTranslatedText: "baseline" }]);
  const requests: Array<{ url: string; init?: RequestInit; body: any }> = [];
  const provider = new GeminiRefinementProvider(async (input, init) => {
    requests.push({ url: String(input), init, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"items":[{"id":"S0","t":"love"}]}' }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const model = descriptor("models/gemini-2.5-flash");
  const lyricContext = { title: "Song", artists: ["Artist"], album: "Album" };
  const result = await provider.translateChunk({ context: lyricContext, target: "en", instructions: "Keep names.", items: [{ id: "S0", c: "ordinary", v: "alternate", s: "amor" }] }, {
    providerVersion: "v1beta", model, targetLang: "en", context: lyricContext, promptVersion: 3, temperature: 0,
    contextMode: "document_or_v1_chunks", credential: { secret: "private-key" }, repair: false, maxOutputTokens: 128, captureId: getActiveProviderCaptureId(),
  }, new AbortController().signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.items, [{ id: "S0", t: "love" }]);
  assert.deepEqual(result.usage, { input: 12, output: 3 });
  assert.equal(result.finish, "stop");
  captureProviderAcceptedItems(getActiveProviderCaptureId(), result.items);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.doesNotMatch(requests[0].url, /private-key|key=/);
  assert.equal(new Headers(requests[0].init?.headers).get("x-goog-api-key"), "private-key");
  assert.equal(requests[0].body.generationConfig.responseMimeType, "application/json");
  assert.equal(requests[0].body.generationConfig.responseSchema.properties.items.type, "ARRAY");
  assert.deepEqual(JSON.parse(requests[0].body.contents[0].parts[0].text), { context: lyricContext, target: "en", instructions: "Keep names.", items: [{ id: "S0", c: "ordinary", v: "alternate", s: "amor" }] });
  assert.doesNotMatch(requests[0].body.systemInstruction.parts[0].text, /Keep names/);
  assert.match(requests[0].body.systemInstruction.parts[0].text, /Return every requested id exactly once/);
  assert.deepEqual(requests[0].body.contents.map((content: { role: string }) => content.role), ["user"]);
  assert.deepEqual(getProviderComparisonRows(), [{ id: "S0", original: "amor", baseline: "baseline", attempts: [{ number: 1, text: "love", model: "models/gemini-2.5-flash", repair: false, accepted: true }] }]);
  assert.equal(getProviderCaptureMetadata()?.providerId, "gemini");
  assert.match(getProviderCaptureMetadata()?.systemPrompt ?? "", /Return every requested id exactly once/);
  clearProviderCapture();
});

test("Gemini model probe and typed failures use the same direct transport", async () => {
  const model = descriptor("models/gemini-2.5-flash");
  const probe = new GeminiRefinementProvider(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '{"items":[{"id":"P0","t":"hello"}]}' }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
  }), { status: 200 }));
  assert.deepEqual(await probe.probeModel(model, { secret: "key" }, new AbortController().signal), { ok: true, usage: { input: 5, output: 2 } });

  const unavailable = new GeminiRefinementProvider(async () => new Response("sensitive", { status: 404 }));
  const missing = await unavailable.translateChunk({ context: EMPTY_LYRIC_CONTEXT, target: "en", items: [{ id: "S0", c: "ordinary", v: null, s: "amor" }] }, {
    providerVersion: "v1beta", model, targetLang: "en", context: EMPTY_LYRIC_CONTEXT, promptVersion: 3, temperature: 0,
    contextMode: "document_or_v1_chunks", credential: { secret: "key" }, repair: false, maxOutputTokens: 128,
  }, new AbortController().signal);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.failure.kind, "model_unavailable");
});
