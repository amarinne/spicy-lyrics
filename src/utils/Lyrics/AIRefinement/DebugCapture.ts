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
  baseline: Array<{ id: string; baseline: string }>;
  exchanges: ProviderExchangeCapture[];
};

export type ProviderComparisonRow = { id: string; baseline: string; ai: string };
export type CaptureState = { enabled: boolean; durable: boolean; captureId: string | null; exchanges: ReadonlyArray<ProviderExchangeCapture> };
export type ProviderCaptureSummary = { id: string; trackUri: string | null; trackLabel: string | null; model: string | null; attempts: number; updatedAt: number };

let capture: DurableProviderCapture | null = null;
let writeChain = Promise.resolve();
const listeners = new Set<(state: CaptureState) => void>();

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function notify(): void {
  const state = getProviderCaptureState();
  for (const listener of listeners) listener(state);
}

function persistCurrent(): void {
  if (!capture || typeof indexedDB === "undefined") return;
  const snapshot = structuredClone(capture);
  writeChain = writeChain.then(async () => {
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    const db = await dbPromise;
    await db.put(ObjectStores.AICaptures, snapshot);
  }).catch(() => undefined);
}

export function getProviderCaptureState(): CaptureState {
  return { enabled: capture?.enabled ?? false, durable: !!capture, captureId: capture?.id ?? null, exchanges: capture?.exchanges.map((exchange) => structuredClone(exchange)) ?? [] };
}

export function getActiveProviderCaptureId(): string | null {
  return capture?.enabled ? capture.id : null;
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
  capture = { ...structuredClone(latest), enabled: false };
  persistCurrent();
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
  capture = { ...structuredClone(selected), enabled: false };
  notify();
  return true;
}

export function startProviderCapture(): void {
  const now = Date.now();
  capture = { id: newId(), schema: 1, createdAt: now, updatedAt: now, enabled: true, trackUri: null, trackLabel: null, baseline: [], exchanges: [] };
  persistCurrent(); notify();
}

export function stopProviderCapture(): void {
  if (!capture) return;
  capture.enabled = false; capture.updatedAt = Date.now();
  persistCurrent(); notify();
}

export async function deleteProviderCapture(): Promise<void> {
  const id = capture?.id;
  capture = null;
  if (id && typeof indexedDB !== "undefined") {
    await writeChain;
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    await (await dbPromise).delete(ObjectStores.AICaptures, id);
  }
  notify();
  await loadLatestProviderCapture();
}

export function clearProviderCapture(): void { void deleteProviderCapture(); }

export async function deleteAllProviderCaptures(): Promise<void> {
  capture = null;
  if (typeof indexedDB !== "undefined") {
    await writeChain;
    const { dbPromise, ObjectStores } = await import("../../db.ts");
    await (await dbPromise).clear(ObjectStores.AICaptures);
  }
  notify();
}

export function captureProviderBaseline(trackUri: string, trackLabel: string | null, rows: ReadonlyArray<{ id: string; baselineTranslatedText?: string }>): void {
  if (!capture?.enabled) return;
  if (capture.trackUri && capture.trackUri !== trackUri) {
    const now = Date.now();
    capture = { id: newId(), schema: 1, createdAt: now, updatedAt: now, enabled: true, trackUri: null, trackLabel: null, baseline: [], exchanges: [] };
  }
  capture.trackUri = trackUri;
  capture.trackLabel = trackLabel;
  capture.baseline = rows.map((row) => ({ id: row.id, baseline: row.baselineTranslatedText ?? "" }));
  capture.updatedAt = Date.now();
  persistCurrent(); notify();
}

export function captureProviderExchange(captureId: string | null, exchange: ProviderExchangeCapture): void {
  if (!captureId || !capture?.enabled || capture.id !== captureId) return;
  capture.exchanges = [...capture.exchanges.slice(-3), structuredClone(exchange)];
  capture.updatedAt = Date.now();
  persistCurrent(); notify();
}

export async function downloadProviderCapture(): Promise<string | null> {
  if (!capture?.exchanges.length) return null;
  const model = capture.exchanges.at(-1)?.model.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "model";
  const filename = `spicy-ai-capture-${model}-${new Date(capture.updatedAt).toISOString().replace(/[:.]/g, "-")}.json`;
  const contents = JSON.stringify(capture, null, 2);
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

function latestAIItems(): Array<{ id?: unknown; t?: unknown }> {
  for (const exchange of [...(capture?.exchanges ?? [])].reverse()) {
    const content = (exchange.response as any)?.choices?.[0]?.message?.content;
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
  const byId = new Map(latestAIItems().filter((item) => typeof item?.id === "string" && typeof item?.t === "string").map((item) => [item.id as string, item.t as string]));
  return (capture?.baseline ?? []).map((row) => ({ id: row.id, baseline: row.baseline, ai: byId.get(row.id) ?? "" }));
}

export function getProviderCaptureMetadata(): { model: string; providerId: string; endpoint: string; attempts: number; systemPrompt: string; trackUri: string | null; trackLabel: string | null; updatedAt: number } | null {
  const latest = capture?.exchanges.at(-1);
  if (!capture || !latest) return null;
  const messages = (latest.request as any)?.messages;
  const systemPrompt = Array.isArray(messages) ? messages.find((message) => message?.role === "system")?.content : "";
  return { model: latest.model, providerId: latest.providerId, endpoint: latest.endpoint, attempts: capture.exchanges.length, systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "", trackUri: capture.trackUri, trackLabel: capture.trackLabel, updatedAt: capture.updatedAt };
}
