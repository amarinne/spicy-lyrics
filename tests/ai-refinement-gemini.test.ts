import assert from "node:assert/strict";
import { test } from "node:test";
import { GeminiRefinementProvider } from "../src/utils/Lyrics/AIRefinement/GeminiProvider.ts";

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

test("Gemini discovery maps authentication and server failures without reading bodies", async () => {
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
