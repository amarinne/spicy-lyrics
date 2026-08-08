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

const model = { name: "fake-model", version: "1", inputTokenLimit: 32_768, outputTokenLimit: 1_000, supportedGenerationMethods: ["generateContent"] };
const config: CoordinatorConfig = { providerVersion: "1", model, targetLang: "en", credential: { secret: "private" } };

function baseline(text = "愛", translated = "love") {
  const original = { Type: "Static", Language: "jpn", uri: "spotify:track:test", Lines: [{ Text: text }] };
  const snapshot = captureOriginalSnapshot(original, "en");
  return { snapshot, document: { ...original, ProcessingPending: false, RomanizationPending: false, TranslationPending: false, IncludesTranslation: true, Lines: [{ Text: text, TranslatedText: translated }] } };
}

function harness(provider = new FakeRefinementProvider(), cache = new MemoryRefinementCache(), getConfig = async () => config) {
  const publications: Array<{ trackUri: string; document: any; origin: string }> = [];
  const coordinator = new AIRefinementCoordinator({ cache, provider, getConfig, publish: (trackUri, document, origin) => publications.push({ trackUri, document: structuredClone(document), origin }) });
  coordinator.setEnabled(true);
  coordinator.onTrackChanged("spotify:track:test");
  return { coordinator, provider, cache, publications };
}

async function waitFor(predicate: () => boolean, message = "condition"): Promise<void> {
  for (let i = 0; i < 100; i++) {
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

test("an older config preparation cannot overwrite or auto-apply after config change", async () => {
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
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(next.publications.at(-1).origin, "baseline");
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

test("cache auto-apply requires a settled eligible translated baseline", async () => {
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
  assert.equal(unready.publications.at(-1).origin, "baseline");
  assert.equal(unready.provider.calls.length, 0);
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
