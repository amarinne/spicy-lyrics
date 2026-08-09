import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AIRefinementCoordinator,
  FakeRefinementProvider,
  MemoryRefinementCache,
  captureOriginalSnapshot,
  type CoordinatorConfig,
  type ProviderResult,
} from "../src/utils/Lyrics/AIRefinement/index.ts";
import { clearProviderCapture, getProviderCaptureState } from "../src/utils/Lyrics/AIRefinement/DebugCapture.ts";

const model = { name: "fake-model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 1_000, supportedGenerationMethods: ["generateContent"] };
const config: CoordinatorConfig = { providerVersion: "1", model, targetLang: "en", credential: { secret: "private" } };

function baseline(text = "愛", translated = "love") {
  const original = { Type: "Static", Language: "jpn", uri: "spotify:track:test", Lines: [{ Text: text }] };
  const snapshot = captureOriginalSnapshot(original, "en");
  return { snapshot, document: { ...original, ProcessingPending: false, RomanizationPending: false, TranslationPending: false, IncludesTranslation: true, Lines: [{ Text: text, TranslatedText: translated }] } };
}

function harness(provider = new FakeRefinementProvider(), cache = new MemoryRefinementCache(), getConfig = async () => config, getContext?: () => { title: string | null; artists: string[]; album: string | null }) {
  const publications: Array<{ trackUri: string; document: any; origin: string }> = [];
  const coordinator = new AIRefinementCoordinator({ cache, provider, getConfig, getContext, publish: (trackUri, document, origin) => publications.push({ trackUri, document: structuredClone(document), origin }) });
  coordinator.setEnabled(true);
  coordinator.onTrackChanged("spotify:track:test");
  return { coordinator, provider, cache, publications };
}

async function waitFor(predicate: () => boolean, message = "condition"): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

test("coordinator publishes baseline then an atomic overlay without mutating baseline", async () => {
  const { coordinator, publications } = harness();
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined", "refined state");
  assert.deepEqual(publications.map((item) => item.origin), ["baseline", "overlay"]);
  assert.equal(publications.at(-1).document.Lines[0].TranslatedText, "AI 愛");
  assert.equal(coordinator.getBaselineDocument("spotify:track:test").Lines[0].TranslatedText, "love");
  assert.equal("AIOriginalSnapshot" in publications.at(-1).document, false);
});

test("accepted output can be revised with the latest output, a new note, and a different model", async () => {
  const nextModel = { ...model, name: "fake-model-2" };
  const provider = new FakeRefinementProvider([
    { ok: true, items: [{ id: "S0", t: "first AI" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 24 } },
    (request, runConfig) => {
      assert.equal(runConfig.iteration, true);
      assert.equal(runConfig.model.name, "fake-model-2");
      assert.match(runConfig.instructions ?? "", /Make it warmer/);
      assert.deepEqual(request.items, [{ id: "S0", c: "ordinary", v: null, s: "愛", p: "first AI" }]);
      return { ok: true, items: [{ id: "S0", t: "warmer AI" }], usage: { input: 6, output: 3 }, finish: "stop", raw: { bytes: 26 } };
    },
  ]);
  const cache = new MemoryRefinementCache();
  const { coordinator, publications } = harness(provider, cache);
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  coordinator.refineOutput("spotify:track:test", { instructions: "Make it warmer.", model: nextModel });
  await waitFor(() => coordinator.getState("spotify:track:test").revisionNumber === 1 && coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(publications.at(-1).document.Lines[0].TranslatedText, "warmer AI");
  assert.equal(coordinator.getState("spotify:track:test").modelName, "fake-model-2");
  const records = cache.snapshot();
  assert.equal(records.length, 2);
  const revision = records.find((record) => record.revisionNumber === 1)!;
  assert.equal(revision.revisionInstructions, "Make it warmer.");
  const original = records.find((record) => !record.revisionNumber)!;
  assert.equal(revision.parentRecordKey, original.key);
  assert.equal(revision.rootRecordKey, original.key);

  const reopened = harness(new FakeRefinementProvider(), cache);
  reopened.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await waitFor(() => reopened.coordinator.getState("spotify:track:test").status === "refined", "latest revision auto-applied");
  assert.equal(reopened.publications.at(-1).document.Lines[0].TranslatedText, "warmer AI");
  assert.equal(reopened.provider.calls.length, 0);
});

test("an initial request can add one-off preset steering and select a model without changing global config", async () => {
  const nextModel = { ...model, name: "fake-model-2" };
  const provider = new FakeRefinementProvider([(request, runConfig) => {
    assert.equal(runConfig.iteration, false);
    assert.equal(runConfig.model.name, "fake-model-2");
    assert.equal(runConfig.instructions, "Always preserve names.\nKeep mixed-language phrases natural.");
    assert.equal(request.items[0].p, undefined);
    return { ok: true, items: [{ id: "S0", t: "contextual AI" }], usage: { input: 5, output: 2 }, finish: "stop", raw: { bytes: 24 } };
  }]);
  const cache = new MemoryRefinementCache();
  const customConfig = { ...config, instructions: "Always preserve names." };
  const { coordinator } = harness(provider, cache, async () => customConfig);
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test", { instructions: "Keep mixed-language phrases natural.", model: nextModel });
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(coordinator.getState("spotify:track:test").modelName, "fake-model-2");
  assert.equal(cache.snapshot()[0].modelName, "fake-model-2");
  assert.equal(customConfig.model.name, "fake-model");
  assert.equal(customConfig.instructions, "Always preserve names.");
});

test("preset-driven paid output auto-applies on revisit without another provider call", async () => {
  const cache = new MemoryRefinementCache();
  const paidProvider = new FakeRefinementProvider([{ ok: true, items: [{ id: "S0", t: "saved preset output" }], usage: { input: 5, output: 2 }, finish: "stop", raw: { bytes: 24 } }]);
  const first = harness(paidProvider, cache);
  const value = baseline();
  first.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  first.coordinator.refine("spotify:track:test", { instructions: "Keep the tone intimate.", model: { ...model, name: "alternate-model" } });
  await waitFor(() => first.coordinator.getState("spotify:track:test").status === "refined");

  const revisitProvider = new FakeRefinementProvider();
  const revisit = harness(revisitProvider, cache);
  revisit.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await waitFor(() => revisit.coordinator.getState("spotify:track:test").status === "refined", "preset output auto-applied");
  assert.equal(revisit.publications.at(-1).document.Lines[0].TranslatedText, "saved preset output");
  assert.equal(revisitProvider.calls.length, 0);
});

test("newest compatible paid document wins across preset and model identities", async () => {
  const cache = new MemoryRefinementCache();
  const value = baseline();
  const first = harness(new FakeRefinementProvider([{ ok: true, items: [{ id: "S0", t: "older output" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 20 } }]), cache);
  first.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  first.coordinator.refine("spotify:track:test", { instructions: "First preset." });
  await waitFor(() => first.coordinator.getState("spotify:track:test").status === "refined");
  await new Promise((resolve) => setTimeout(resolve, 2));

  const second = harness(new FakeRefinementProvider([{ ok: true, items: [{ id: "S0", t: "newer output" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 20 } }]), cache);
  second.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await waitFor(() => second.coordinator.getState("spotify:track:test").status === "refined");
  second.coordinator.refineOutput("spotify:track:test", { instructions: "Second preset.", model: { ...model, name: "new-model" } });
  await waitFor(() => second.coordinator.getState("spotify:track:test").status === "refined" && second.coordinator.getState("spotify:track:test").modelName === "new-model");

  const revisit = harness(new FakeRefinementProvider(), cache);
  revisit.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await waitFor(() => revisit.coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(revisit.publications.at(-1).document.Lines[0].TranslatedText, "newer output");
  assert.equal(revisit.provider.calls.length, 0);
});

test("paid output never crosses document or target-language identity", async () => {
  const cache = new MemoryRefinementCache();
  const value = baseline();
  const first = harness(new FakeRefinementProvider(), cache);
  first.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  first.coordinator.refine("spotify:track:test", { instructions: "Saved preset." });
  await waitFor(() => first.coordinator.getState("spotify:track:test").status === "refined");

  const changedDocument = baseline("歌", "song");
  const documentRevisit = harness(new FakeRefinementProvider(), cache);
  documentRevisit.coordinator.acceptBaseline("spotify:track:test", changedDocument.document, "final", changedDocument.snapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(documentRevisit.coordinator.getState("spotify:track:test").status, "idle");
  assert.equal(documentRevisit.publications.at(-1).origin, "baseline");

  const targetRevisit = harness(new FakeRefinementProvider(), cache, async () => ({ ...config, targetLang: "vi" }));
  targetRevisit.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(targetRevisit.coordinator.getState("spotify:track:test").status, "idle");
  assert.equal(targetRevisit.publications.at(-1).origin, "baseline");
});

test("explicit retry after restart resets only failed chunk attempt caps and preserves paid accounting", async () => {
  const firstProvider = new FakeRefinementProvider([
    { ok: true, items: [{ id: "S0", t: "愛" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 20 } },
    { ok: true, items: [{ id: "S0", t: "愛" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 20 } },
  ]);
  const cache = new MemoryRefinementCache();
  const first = harness(firstProvider, cache);
  const value = baseline();
  first.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  first.coordinator.refine("spotify:track:test");
  await waitFor(() => first.coordinator.getState("spotify:track:test").status === "failed");
  const spent = cache.snapshot()[0].budgetConsumed;
  const retryProvider = new FakeRefinementProvider([{ ok: true, items: [{ id: "S0", t: "retry success" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 24 } }]);
  const reopened = harness(retryProvider, cache);
  reopened.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  reopened.coordinator.refine("spotify:track:test");
  await waitFor(() => reopened.coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(retryProvider.calls.length, 1);
  assert.ok(cache.snapshot()[0].budgetConsumed > spent);
});

test("coordinator captures track metadata with the baseline and sends voice-aware context", async () => {
  let context = { title: "Song A", artists: ["Artist A"], album: "Album A" };
  const { coordinator, provider } = harness(new FakeRefinementProvider(), new MemoryRefinementCache(), async () => config, () => context);
  const original = { Type: "Line", Language: "jpn", Content: [{ Type: "Vocal", Text: "愛" }, { Type: "Vocal", Text: "歌", OppositeAligned: true }] };
  const snapshot = captureOriginalSnapshot(original, "en");
  const document = { ...original, ProcessingPending: false, RomanizationPending: false, Content: original.Content.map((line, index) => ({ ...line, TranslatedText: index ? "song" : "love" })) };
  coordinator.acceptBaseline("spotify:track:test", document, "final", snapshot);
  context = { title: "Song B", artists: ["Artist B"], album: "Album B" };
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.deepEqual(provider.calls[0].request, {
    context: { title: "Song A", artists: ["Artist A"], album: "Album A" },
    target: "en",
    items: [
      { id: "G0", c: "ordinary", v: "primary", s: "愛" },
      { id: "G1", c: "ordinary", v: "alternate", s: "歌" },
    ],
  });
});

test("double taps coalesce and track change cancels late provider work", async () => {
  let release: (value: ProviderResult) => void;
  const provider = new FakeRefinementProvider([() => new Promise<ProviderResult>((resolve) => { release = resolve; })]);
  const { coordinator } = harness(provider);
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  coordinator.refine("spotify:track:test");
  await waitFor(() => provider.calls.length === 1, "one provider call");
  coordinator.onTrackChanged("spotify:track:other");
  release!({ ok: true, items: [{ id: "S0", t: "late" }], usage: { input: 2, output: 2 }, finish: "stop", raw: { bytes: 20 } });
  await waitFor(() => coordinator.getState("spotify:track:test").status === "cancelled", "cancelled state");
  assert.equal(coordinator.getState("spotify:track:test").reason, "track_change");
});

test("abort after dispatch preserves ambiguous attempt and reservation accounting", async () => {
  const provider = new FakeRefinementProvider([(_request, _config, signal) => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
  const cache = new MemoryRefinementCache();
  const { coordinator } = harness(provider, cache);
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => provider.calls.length === 1);
  coordinator.onTrackChanged("spotify:track:other");
  await waitFor(() => cache.snapshot().length === 1, "ambiguous attempt persisted");
  const record = cache.snapshot()[0];
  assert.equal(record.status, "failed");
  assert.equal(record.chunks.C0.attempts, 1);
  assert.equal(record.chunks.C0.failure?.reason, "delivery_unknown");
  assert.ok(record.budgetConsumed > 0);
});

test("late same-track baseline supersedes a run and cannot be overwritten", async () => {
  let release: (value: ProviderResult) => void;
  const provider = new FakeRefinementProvider([() => new Promise<ProviderResult>((resolve) => { release = resolve; })]);
  const { coordinator, publications } = harness(provider);
  const first = baseline("愛", "love");
  coordinator.acceptBaseline("spotify:track:test", first.document, "final", first.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => provider.calls.length === 1);
  const second = baseline("歌", "song");
  coordinator.acceptBaseline("spotify:track:test", second.document, "final", second.snapshot);
  release!({ ok: true, items: [{ id: "S0", t: "late love" }], usage: { input: 2, output: 2 }, finish: "stop", raw: { bytes: 20 } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(publications.at(-1).document.Lines[0].Text, "歌");
  assert.equal(publications.at(-1).origin, "baseline");
});

test("Restore suppresses exact cache auto-apply until explicit Refine", async () => {
  const { coordinator, provider, publications } = harness();
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  coordinator.restoreBaseline("spotify:track:test");
  const calls = provider.calls.length;
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(publications.at(-1).origin, "baseline");
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(provider.calls.length, calls);
  assert.equal(publications.at(-1).origin, "overlay");
});

test("Restore then Refine reuses a one-off preset and model result without rebilling", async () => {
  const provider = new FakeRefinementProvider([{ ok: true, items: [{ id: "S0", t: "one-off paid output" }], usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 24 } }]);
  const { coordinator, publications } = harness(provider);
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test", { instructions: "Use this one-off style.", model: { ...model, name: "one-off-model" } });
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  coordinator.restoreBaseline("spotify:track:test");
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(provider.calls.length, 1);
  assert.equal(publications.at(-1).document.Lines[0].TranslatedText, "one-off paid output");
});

test("kill switch drops overlays, keeps cache, and blocks auto-apply", async () => {
  const { coordinator, cache, publications } = harness();
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  const cached = cache.snapshot().length;
  coordinator.setEnabled(false);
  assert.equal(publications.at(-1).origin, "baseline");
  assert.equal(cache.snapshot().length, cached);
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(publications.at(-1).origin, "baseline");
});

test("exact paid cache auto-applies without a credential", async () => {
  const cache = new MemoryRefinementCache();
  const first = harness(new FakeRefinementProvider(), cache);
  const value = baseline();
  first.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  first.coordinator.refine("spotify:track:test");
  await waitFor(() => first.coordinator.getState("spotify:track:test").status === "refined");

  const second = harness(new FakeRefinementProvider(), cache, async () => ({ ...config, credential: null }));
  second.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  await waitFor(() => second.coordinator.getState("spotify:track:test").status === "refined", "credential-free cache apply");
  assert.equal(second.publications.at(-1).origin, "overlay");
  assert.equal(second.provider.calls.length, 0);
});

test("exact Sound cache is checked before credential storage or provider work", async () => {
  const cache = new MemoryRefinementCache();
  const soundConfig = { ...config, targetLang: "Latin" };
  const paidProvider = new FakeRefinementProvider([(request) => ({ ok: true, items: request.items.map((item) => ({ id: item.id, t: "sarang" })), usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 32 } })]);
  const paid = new AIRefinementCoordinator({ layer: "sound", cache, provider: paidProvider, getConfig: async () => soundConfig, publish: () => undefined });
  paid.setEnabled(true); paid.onTrackChanged("spotify:track:test");
  const source = { Type: "Static", Language: "kor", Lines: [{ Text: "사랑", RomanizedText: "builtin" }], ProcessingPending: false, RomanizationPending: false };
  const snapshot = captureOriginalSnapshot(source, null);
  paid.acceptBaseline("spotify:track:test", source, "final", snapshot);
  paid.refine("spotify:track:test");
  await waitFor(() => paid.getState("spotify:track:test").status === "refined");
  assert.equal(cache.snapshot()[0].schema, 2);
  assert.match(cache.snapshot()[0].key, /\|2\|/);

  let credentialReads = 0;
  const provider = new FakeRefinementProvider();
  const cached = new AIRefinementCoordinator({ layer: "sound", cache, provider, getConfig: async () => ({ ...soundConfig, credential: undefined }), getCredential: async () => { credentialReads++; return null; }, publish: () => undefined });
  cached.setEnabled(true); cached.onTrackChanged("spotify:track:test");
  cached.acceptBaseline("spotify:track:test", source, "final", snapshot);
  await waitFor(() => cached.getState("spotify:track:test").status === "refined");
  assert.equal(credentialReads, 0);
  assert.equal(provider.calls.length, 0);
});

test("Sound cache does not cross source-language identity", async () => {
  const cache = new MemoryRefinementCache();
  const soundConfig = { ...config, targetLang: "Latin" };
  const paidProvider = new FakeRefinementProvider([(request) => ({ ok: true, items: request.items.map((item) => ({ id: item.id, t: "sarang" })), usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 32 } })]);
  const paid = new AIRefinementCoordinator({ layer: "sound", cache, provider: paidProvider, getConfig: async () => soundConfig, publish: () => undefined });
  paid.setEnabled(true); paid.onTrackChanged("spotify:track:test");
  const korean = { Type: "Static", Language: "kor", Lines: [{ Text: "歌" }], ProcessingPending: false, RomanizationPending: false };
  paid.acceptBaseline("spotify:track:test", korean, "final", captureOriginalSnapshot(korean, null));
  paid.refine("spotify:track:test");
  await waitFor(() => paid.getState("spotify:track:test").status === "refined");
  assert.equal(cache.snapshot()[0].sourceLanguage, "kor");

  const provider = new FakeRefinementProvider();
  const revisit = new AIRefinementCoordinator({ layer: "sound", cache, provider, getConfig: async () => soundConfig, publish: () => undefined });
  revisit.setEnabled(true); revisit.onTrackChanged("spotify:track:test");
  const japanese = { ...korean, Language: "jpn" };
  revisit.acceptBaseline("spotify:track:test", japanese, "final", captureOriginalSnapshot(japanese, null));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(revisit.getState("spotify:track:test").status, "idle");
  assert.equal(provider.calls.length, 0);
});

test("local tracks, missing credential and unsettled baselines fail closed", async () => {
  const missing = harness(new FakeRefinementProvider(), new MemoryRefinementCache(), async () => ({ ...config, credential: null }));
  const value = baseline();
  missing.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  missing.coordinator.refine("spotify:track:test");
  await waitFor(() => missing.coordinator.getState("spotify:track:test").status === "failed");
  assert.equal(missing.coordinator.getState("spotify:track:test").reason, "no_credential");

  const local = harness();
  local.coordinator.onTrackChanged("spotify:local:artist:title:1");
  local.coordinator.acceptBaseline("spotify:local:artist:title:1", value.document, "final", value.snapshot);
  local.coordinator.refine("spotify:local:artist:title:1");
  await waitFor(() => local.coordinator.getState("spotify:local:artist:title:1").status === "failed");
  assert.equal(local.coordinator.getState("spotify:local:artist:title:1").reason, "baseline_unavailable");
});

test("cache write failure warns but does not discard a valid overlay", async () => {
  const cache = new MemoryRefinementCache();
  cache.failWrites = true;
  const { coordinator, publications } = harness(new FakeRefinementProvider(), cache);
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(coordinator.getState("spotify:track:test").cacheWarning, "write_failed");
  assert.equal(publications.at(-1).origin, "overlay");
});

test("partial records resume exact incomplete chunks without resending completed work", async () => {
  const manyOriginal = { Type: "Static", Language: "jpn", uri: "spotify:track:test", Lines: Array.from({ length: 129 }, (_, i) => ({ Text: `源${i}` })) };
  const snapshot = captureOriginalSnapshot(manyOriginal, "en");
  const document = { ...manyOriginal, ProcessingPending: false, RomanizationPending: false, TranslationPending: false, IncludesTranslation: true, Lines: manyOriginal.Lines.map((line, i) => ({ ...line, TranslatedText: `baseline ${i}` })) };
  const success = (request: any) => ({ ok: true, items: request.items.map((item: any) => ({ id: item.id, t: `AI ${item.s}` })), usage: { input: 10, output: 10 }, finish: "stop", raw: { bytes: 100 } }) as ProviderResult;
  const provider = new FakeRefinementProvider([
    (request) => success(request),
    { ok: false, failure: { kind: "delivery_unknown", cause: "network" } },
    (request) => success(request),
    (request) => success(request),
  ]);
  const { coordinator } = harness(provider);
  coordinator.acceptBaseline("spotify:track:test", document, "final", snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "failed");
  assert.deepEqual((provider.calls[0].request as any).items.map((item: any) => item.id), Array.from({ length: 64 }, (_, i) => `S${i}`));
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(provider.calls.filter((call) => (call.request as any).items[0].id === "S0").length, 1);
  assert.equal(provider.calls.length, 4);
});

test("config and credential changes cancel work; clear cannot be repopulated by a late result", async () => {
  for (const action of ["config", "credential", "clear"] as const) {
    let release: (value: ProviderResult) => void;
    const cache = new MemoryRefinementCache();
    const provider = new FakeRefinementProvider([() => new Promise<ProviderResult>((resolve) => { release = resolve; })]);
    const { coordinator } = harness(provider, cache);
    const value = baseline();
    coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
    coordinator.refine("spotify:track:test");
    await waitFor(() => provider.calls.length === 1);
    if (action === "config") coordinator.notifyConfigChanged();
    if (action === "credential") coordinator.notifyCredentialChanged();
    if (action === "clear") await coordinator.clearTrack("spotify:track:test");
    release!({ ok: true, items: [{ id: "S0", t: "late" }], usage: { input: 2, output: 2 }, finish: "stop", raw: { bytes: 20 } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (action === "config") assert.equal(coordinator.getState("spotify:track:test").reason, "config_changed");
    if (action === "credential") assert.equal(coordinator.getState("spotify:track:test").reason, "credential_changed");
    if (action === "clear") assert.equal(cache.snapshot().length, 0);
  }
});

test("async config/cache preparation cannot apply an old overlay to a newer baseline", async () => {
  let resolveConfig: (value: CoordinatorConfig) => void;
  const configPromise = new Promise<CoordinatorConfig>((resolve) => { resolveConfig = resolve; });
  const { coordinator, publications } = harness(new FakeRefinementProvider(), new MemoryRefinementCache(), () => configPromise);
  const first = baseline("愛", "love");
  coordinator.acceptBaseline("spotify:track:test", first.document, "final", first.snapshot);
  const second = baseline("歌", "song");
  coordinator.acceptBaseline("spotify:track:test", second.document, "final", second.snapshot);
  resolveConfig!(config);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(publications.at(-1).document.Lines[0].Text, "歌");
  assert.equal(publications.at(-1).origin, "baseline");
});

test("an older config preparation cannot win, while accepted output remains authoritative after config change", async () => {
  const cache = new MemoryRefinementCache();
  const oldConfig = config;
  const paid = harness(new FakeRefinementProvider(), cache, async () => oldConfig);
  const value = baseline();
  paid.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  paid.coordinator.refine("spotify:track:test");
  await waitFor(() => paid.coordinator.getState("spotify:track:test").status === "refined");

  const newConfig = { ...config, model: { ...model, name: "new-model" } };
  let resolveOld: (value: CoordinatorConfig) => void;
  const oldPending = new Promise<CoordinatorConfig>((resolve) => { resolveOld = resolve; });
  let calls = 0;
  const next = harness(new FakeRefinementProvider(), cache, async () => calls++ === 0 ? oldPending : newConfig);
  next.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  next.coordinator.notifyConfigChanged();
  resolveOld!(oldConfig);
  await waitFor(() => next.coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(next.publications.at(-1).origin, "overlay");
  assert.equal(next.publications.at(-1).document.Lines[0].TranslatedText, "AI 愛");
  assert.equal(next.provider.calls.length, 0);
});

test("baseline change during pre-dispatch config await cancels before billing", async () => {
  let resolveConfig: (value: CoordinatorConfig) => void;
  const configPromise = new Promise<CoordinatorConfig>((resolve) => { resolveConfig = resolve; });
  const provider = new FakeRefinementProvider();
  const { coordinator } = harness(provider, new MemoryRefinementCache(), () => configPromise);
  const first = baseline("愛", "love");
  coordinator.acceptBaseline("spotify:track:test", first.document, "final", first.snapshot);
  coordinator.refine("spotify:track:test");
  const second = baseline("歌", "song");
  coordinator.acceptBaseline("spotify:track:test", second.document, "final", second.snapshot);
  resolveConfig!(config);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.calls.length, 0);
  assert.equal(coordinator.getState("spotify:track:test").reason, "baseline_superseded");
});

test("cancellation during persistence preparation finishes automatic request capture", async () => {
  clearProviderCapture();
  let releasePersistence: (value: boolean) => void;
  const provider = new FakeRefinementProvider();
  const cache = new MemoryRefinementCache();
  const coordinator = new AIRefinementCoordinator({
    cache, provider, getConfig: async () => config, publish: () => undefined,
    ensurePersistence: () => new Promise<boolean>((resolve) => { releasePersistence = resolve; }),
  });
  coordinator.setEnabled(true);
  coordinator.onTrackChanged("spotify:track:test");
  const value = baseline();
  coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => !!getProviderCaptureState().activeCaptureId, "active request capture");
  coordinator.onTrackChanged("spotify:track:other");
  releasePersistence!(true);
  await waitFor(() => getProviderCaptureState().activeCaptureId === null, "finished request capture");
  assert.equal(provider.calls.length, 0);
  clearProviderCapture();
});

test("cache auto-apply does not require a machine-translation baseline", async () => {
  const cache = new MemoryRefinementCache();
  const paid = harness(new FakeRefinementProvider(), cache);
  const value = baseline();
  paid.coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
  paid.coordinator.refine("spotify:track:test");
  await waitFor(() => paid.coordinator.getState("spotify:track:test").status === "refined");

  const unready = harness(new FakeRefinementProvider(), cache);
  const document = { ...value.document, IncludesTranslation: false, Lines: [{ Text: "愛" }] };
  unready.coordinator.acceptBaseline("spotify:track:test", document, "final", value.snapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(unready.publications.at(-1).origin, "overlay");
  assert.equal(unready.publications.at(-1).document.Lines[0].TranslatedText, "AI 愛");
  assert.equal(unready.provider.calls.length, 0);
});

test("AI meaning can translate canonical source without Google output", async () => {
  const { coordinator, provider, publications } = harness();
  const value = baseline();
  const document = { ...value.document, IncludesTranslation: false, Lines: [{ Text: "愛" }] };
  coordinator.acceptBaseline("spotify:track:test", document, "final", value.snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(provider.calls.length, 1);
  assert.equal(publications.at(-1).document.Lines[0].TranslatedText, "AI 愛");
});

test("automatic AI Meaning runs after final source document while on-demand mode waits", async () => {
  const automatic = harness();
  automatic.coordinator.setMode("auto");
  const value = baseline();
  automatic.coordinator.acceptBaseline("spotify:track:test", { ...value.document, IncludesTranslation: false, Lines: [{ Text: "愛" }] }, "final", value.snapshot);
  await waitFor(() => automatic.coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(automatic.provider.calls.length, 1);

  const manual = harness();
  manual.coordinator.setMode("on_demand");
  manual.coordinator.acceptBaseline("spotify:track:test", { ...value.document, IncludesTranslation: false, Lines: [{ Text: "愛" }] }, "final", value.snapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(manual.provider.calls.length, 0);
});

test("automatic AI config changes dispatch only for the current track", async () => {
  const provider = new FakeRefinementProvider();
  const cache = new MemoryRefinementCache();
  const publications: any[] = [];
  const coordinator = new AIRefinementCoordinator({ cache, provider, getConfig: async () => config, publish: (...args) => publications.push(args) });
  coordinator.setEnabled(true);
  coordinator.setMode("on_demand");
  const old = baseline("旧", "old");
  coordinator.onTrackChanged("spotify:track:old");
  coordinator.acceptBaseline("spotify:track:old", old.document, "final", old.snapshot);
  const current = baseline("今", "now");
  coordinator.onTrackChanged("spotify:track:test");
  coordinator.acceptBaseline("spotify:track:test", current.document, "final", current.snapshot);
  coordinator.setMode("auto");
  coordinator.notifyConfigChanged();
  await waitFor(() => provider.calls.length === 1, "current-track automatic call");
  assert.equal(provider.calls[0].request.items[0].s, "今");
});

test("automatic AI Sound bills only the current track", async () => {
  const provider = new FakeRefinementProvider([(request) => ({ ok: true, items: request.items.map((item) => ({ id: item.id, t: "sa-rang" })), usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 32 } })]);
  const soundConfig = { ...config, targetLang: "Latin" };
  const coordinator = new AIRefinementCoordinator({ layer: "sound", cache: new MemoryRefinementCache(), provider, getConfig: async () => soundConfig, publish: () => undefined });
  coordinator.setEnabled(true);
  coordinator.setMode("auto");
  coordinator.onTrackChanged("spotify:track:current");
  const old = { Type: "Static", Language: "kor", Lines: [{ Text: "사랑", RomanizedText: "builtin" }], ProcessingPending: false, RomanizationPending: false };
  coordinator.acceptBaseline("spotify:track:prefetch", old, "final", captureOriginalSnapshot(old, null));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.calls.length, 0);

  coordinator.acceptBaseline("spotify:track:current", old, "final", captureOriginalSnapshot(old, null));
  await waitFor(() => coordinator.getState("spotify:track:current").status === "refined");
  assert.equal(provider.calls.length, 1);
});

test("Sound coordinator publishes whole-line reading overlays and rejects syllable-timed lyrics", async () => {
  const provider = new FakeRefinementProvider([(request) => ({ ok: true, items: request.items.map((item) => ({ id: item.id, t: "sa-rang" })), usage: { input: 4, output: 2 }, finish: "stop", raw: { bytes: 32 } })]);
  const cache = new MemoryRefinementCache();
  const publications: any[] = [];
  const soundConfig = { ...config, targetLang: "Latin", instructions: "Use a readable pronunciation spelling." };
  const coordinator = new AIRefinementCoordinator({ layer: "sound", cache, provider, getConfig: async () => soundConfig, publish: (_trackUri, document, origin) => publications.push({ document: structuredClone(document), origin }) });
  coordinator.setEnabled(true);
  coordinator.onTrackChanged("spotify:track:test");
  const source = { Type: "Static", Language: "kor", Lines: [{ Text: "사랑", RomanizedText: "sarang" }], ProcessingPending: false, RomanizationPending: false };
  const snapshot = captureOriginalSnapshot(source, null);
  coordinator.acceptBaseline("spotify:track:test", source, "final", snapshot);
  coordinator.refine("spotify:track:test");
  await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
  assert.equal(publications.at(-1).document.Lines[0].RomanizedText, "sa-rang");
  assert.equal(publications.at(-1).document.Lines[0].TransliteratedText, "sa-rang");
  assert.equal(publications.at(-1).document.IncludesRomanization, true);

  const timed = new AIRefinementCoordinator({ layer: "sound", cache: new MemoryRefinementCache(), provider, getConfig: async () => soundConfig, publish: () => undefined });
  timed.setEnabled(true);
  timed.onTrackChanged("spotify:track:timed");
  const timedSource = { Type: "Syllable", Language: "jpn", Content: [], ProcessingPending: false, RomanizationPending: false };
  timed.acceptBaseline("spotify:track:timed", timedSource, "final", captureOriginalSnapshot(timedSource, null));
  timed.refine("spotify:track:timed");
  await waitFor(() => timed.getState("spotify:track:timed").status === "failed");
  assert.equal(timed.getState("spotify:track:timed").reason, "alignment_required");
  assert.equal(provider.calls.length, 1);
});

test("config change and global clear visibly restore the baseline", async () => {
  for (const action of ["config", "clear"] as const) {
    const { coordinator, publications } = harness();
    const value = baseline();
    coordinator.acceptBaseline("spotify:track:test", value.document, "final", value.snapshot);
    coordinator.refine("spotify:track:test");
    await waitFor(() => coordinator.getState("spotify:track:test").status === "refined");
    if (action === "config") coordinator.notifyConfigChanged();
    else await coordinator.clearAll();
    assert.equal(publications.at(-1).origin, "baseline");
    assert.equal(publications.at(-1).document.Lines[0].TranslatedText, "love");
  }
});
