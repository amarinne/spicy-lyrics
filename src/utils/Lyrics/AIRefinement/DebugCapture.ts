export type ProviderExchangeCapture = {
  schema: 1;
  capturedAt: string;
  providerId: string;
  endpoint: string;
  model: string;
  repair: boolean;
  status: number;
  request: unknown;
  response: unknown;
};

export type DurableProviderCapture = {
  id: string;
  schema: 1;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  trackUri: string | null;
  trackLabel: string | null;
  layer: "meaning" | "sound";
  baseline: Array<{ id: string; baseline: string }>;
  exchanges: ProviderExchangeCapture[];
};

export type ProviderComparisonRow = { id: string; baseline: string; ai: string };
export type CaptureState = { enabled: boolean; durable: boolean; captureId: string | null; activeCaptureId: string | null; exchanges: ReadonlyArray<ProviderExchangeCapture> };
export type ProviderCaptureSummary = { id: string; trackUri: string | null; trackLabel: string | null; layer: "meaning" | "sound"; model: string | null; attempts: number; updatedAt: number };

const activeCaptures = new Map<string, DurableProviderCapture>();
let selectedCapture: DurableProviderCapture | null = null;
let writeChain = Promise.resolve();
const listeners = new Set<(state: CaptureState) => void>();

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function notify(): void {
  const state = getProviderCaptureState();
  for (const listener of listeners) listener(state);
}

function latestActiveCapture(): DurableProviderCapture | null { return Array.from(activeCaptures.values()).at(-1) ?? null; }
function displayedCapture(): DurableProviderCapture | null { return selectedCapture ?? latestActiveCapture(); }

function persist(record: DurableProviderCapture): void {
  if (typeof indexedDB === "undefined") return;
  const snapshot = structuredClone(record);
  writeChain = writeChain.then(async () => {
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    const db = await dbPromise;
    await db.put(ObjectStores.AICaptures, snapshot);
  }).catch(() => undefined);
}

export function getProviderCaptureState(): CaptureState {
  const shown = displayedCapture();
  return { enabled: activeCaptures.size > 0, durable: !!shown, captureId: shown?.id ?? null, activeCaptureId: shown && activeCaptures.has(shown.id) ? shown.id : latestActiveCapture()?.id ?? null, exchanges: shown?.exchanges.map((exchange) => structuredClone(exchange)) ?? [] };
}

export function getActiveProviderCaptureId(): string | null {
  return latestActiveCapture()?.id ?? null;
}

export function subscribeProviderCapture(listener: (state: CaptureState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadLatestProviderCapture(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const records = await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  const latest = records.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (!latest) return false;
  selectedCapture = { ...structuredClone(latest), enabled: false };
  notify();
  return true;
}

export async function listProviderCaptures(): Promise<ProviderCaptureSummary[]> {
  if (typeof indexedDB === "undefined") return [];
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const records = await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  return records.sort((left, right) => right.updatedAt - left.updatedAt).map((record) => ({
    id: record.id,
    trackUri: record.trackUri,
    trackLabel: record.trackLabel,
    layer: record.layer ?? "meaning",
    model: record.exchanges.at(-1)?.model ?? null,
    attempts: record.exchanges.length,
    updatedAt: record.updatedAt,
  }));
}

export async function selectProviderCapture(id: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const selected = await (await dbPromise).get(ObjectStores.AICaptures, id) as DurableProviderCapture | undefined;
  if (!selected) return false;
  selectedCapture = { ...structuredClone(selected), enabled: false };
  notify();
  return true;
}

export async function deleteProviderCapture(): Promise<boolean> {
  const id = displayedCapture()?.id;
  if (!id || activeCaptures.has(id)) return false;
  selectedCapture = null;
  if (id && typeof indexedDB !== "undefined") {
    await writeChain;
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    await (await dbPromise).delete(ObjectStores.AICaptures, id);
  }
  notify();
  await loadLatestProviderCapture();
  return true;
}

export function clearProviderCapture(): void { activeCaptures.clear(); selectedCapture = null; notify(); }

export async function deleteAllProviderCaptures(): Promise<boolean> {
  if (activeCaptures.size) return false;
  selectedCapture = null;
  if (typeof indexedDB !== "undefined") {
    await writeChain;
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    await (await dbPromise).clear(ObjectStores.AICaptures);
  }
  notify();
  return true;
}

export function captureProviderBaseline(trackUri: string, trackLabel: string | null, rows: ReadonlyArray<{ id: string; baselineTranslatedText?: string }>, layer: "meaning" | "sound" = "meaning"): string {
  const now = Date.now();
  const activeCapture = {
    id: newId(), schema: 1, createdAt: now, updatedAt: now, enabled: true, trackUri, trackLabel, layer,
    baseline: rows.map((row) => ({ id: row.id, baseline: row.baselineTranslatedText ?? "" })), exchanges: [],
  };
  activeCaptures.set(activeCapture.id, activeCapture);
  selectedCapture = activeCapture;
  persist(activeCapture); notify();
  return activeCapture.id;
}

export function captureProviderExchange(captureId: string | null, exchange: ProviderExchangeCapture): void {
  if (!captureId) return;
  const activeCapture = activeCaptures.get(captureId);
  if (!activeCapture) return;
  activeCapture.exchanges = [...activeCapture.exchanges.slice(-3), structuredClone(exchange)];
  activeCapture.updatedAt = Date.now();
  if (selectedCapture?.id === captureId) selectedCapture = activeCapture;
  persist(activeCapture); notify();
}

export function finishProviderCapture(captureId: string | null): void {
  if (!captureId) return;
  const activeCapture = activeCaptures.get(captureId);
  if (!activeCapture) return;
  activeCapture.enabled = false;
  if (selectedCapture?.id === captureId) selectedCapture = activeCapture;
  persist(activeCapture);
  activeCaptures.delete(captureId);
  notify();
}

async function saveJson(filename: string, contents: string): Promise<string | null> {
  const picker = (window as any).showSaveFilePicker as ((options: unknown) => Promise<any>) | undefined;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: "JSON capture", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return filename;
    } catch (error) {
      if ((error as any)?.name === "AbortError") return null;
      throw error;
    }
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
  return filename;
}

export async function downloadProviderCapture(): Promise<string | null> {
  const shown = displayedCapture();
  if (!shown?.exchanges.length) return null;
  const model = shown.exchanges.at(-1)?.model.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "model";
  const filename = `spicy-ai-capture-${model}-${new Date(shown.updatedAt).toISOString().replace(/[:.]/g, "-")}.json`;
  return saveJson(filename, JSON.stringify(shown, null, 2));
}

export async function downloadAllProviderCaptures(): Promise<{ filename: string; count: number } | null> {
  if (typeof indexedDB === "undefined") return null;
  await writeChain;
  const { dbPromise, ObjectStores } = await import("../../db.ts");
  const records = await (await dbPromise).getAll(ObjectStores.AICaptures) as DurableProviderCapture[];
  if (!records.length) return null;
  records.sort((left, right) => right.updatedAt - left.updatedAt);
  const filename = `spicy-ai-captures-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const saved = await saveJson(filename, JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), captures: records }, null, 2));
  return saved ? { filename: saved, count: records.length } : null;
}

function latestAIItems(): Array<{ id?: unknown; t?: unknown }> {
  for (const exchange of [...(displayedCapture()?.exchanges ?? [])].reverse()) {
    const response = exchange.response as any;
    const content = response?.choices?.[0]?.message?.content
      ?? response?.candidates?.[0]?.content?.parts?.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
    if (typeof content !== "string") continue;
    try {
      const trimmed = content.trim();
      const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      const parsed = JSON.parse(fenced ? fenced[1] : trimmed);
      if (Array.isArray(parsed?.items)) return parsed.items;
    } catch {}
  }
  return [];
}

export function getProviderComparisonRows(): ProviderComparisonRow[] {
  const shown = displayedCapture();
  const byId = new Map(latestAIItems().filter((item) => typeof item?.id === "string" && typeof item?.t === "string").map((item) => [item.id as string, item.t as string]));
  return (shown?.baseline ?? []).map((row) => ({ id: row.id, baseline: row.baseline, ai: byId.get(row.id) ?? "" }));
}

export function getProviderCaptureMetadata(): { model: string; providerId: string; endpoint: string; attempts: number; systemPrompt: string; trackUri: string | null; trackLabel: string | null; layer: "meaning" | "sound"; updatedAt: number } | null {
  const shown = displayedCapture();
  const latest = shown?.exchanges.at(-1);
  if (!shown || !latest) return null;
  const messages = (latest.request as any)?.messages;
  const systemPrompt = Array.isArray(messages)
    ? messages.find((message) => message?.role === "system")?.content
    : (latest.request as any)?.systemInstruction?.parts?.map((part: any) => typeof part?.text === "string" ? part.text : "").join("") ?? "";
  return { model: latest.model, providerId: latest.providerId, endpoint: latest.endpoint, attempts: shown.exchanges.length, systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "", trackUri: shown.trackUri, trackLabel: shown.trackLabel, layer: shown.layer ?? "meaning", updatedAt: shown.updatedAt };
}
