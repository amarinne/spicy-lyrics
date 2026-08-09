type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type JsonResponse = { status: number; body?: unknown; bytes?: number; headers?: Headers };

export async function getJson(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  injectedFetch?: FetchLike,
  maxResponseBytes = 128 * 1024,
): Promise<JsonResponse> {
  const request = injectedFetch ?? fetch;
  const response = await request(url, {
    method: "GET",
    headers,
    signal,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) {
    const parsed = await readBoundedValue(response, maxResponseBytes);
    return { status: response.status, body: parsed.body, bytes: parsed.bytes, headers: response.headers };
  }
  const parsed = await readBoundedJson(response, maxResponseBytes);
  return { status: response.status, body: parsed.body, bytes: parsed.bytes, headers: response.headers };
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<{ body: unknown; bytes: number }> {
  const value = await readBoundedValue(response, maxBytes);
  if (typeof value.body === "string") throw new SyntaxError("invalid_json");
  return value;
}

async function readBoundedValue(response: Response, maxBytes: number): Promise<{ body: unknown; bytes: number }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError(`response_oversized:${declared}`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new RangeError(`response_oversized:${bytes.byteLength}`);
    const text = new TextDecoder().decode(bytes);
    try { return { body: JSON.parse(text), bytes: bytes.byteLength }; } catch { return { body: text, bytes: bytes.byteLength }; }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new RangeError(`response_oversized:${total}`); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { return { body: JSON.parse(text), bytes: total }; } catch { return { body: text, bytes: total }; }
}

export async function postJson(
  url: URL,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  maxResponseBytes: number,
  injectedFetch?: FetchLike,
): Promise<JsonResponse> {
  const request = injectedFetch ?? fetch;
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) {
    const parsed = await readBoundedValue(response, maxResponseBytes);
    return { status: response.status, body: parsed.body, bytes: parsed.bytes, headers: response.headers };
  }
  const parsed = await readBoundedJson(response, maxResponseBytes);
  return { status: response.status, body: parsed.body, bytes: parsed.bytes, headers: response.headers };
}
