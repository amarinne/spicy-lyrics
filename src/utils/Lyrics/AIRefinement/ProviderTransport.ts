type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type JsonResponse = { status: number; body?: unknown; bytes?: number; headers?: Headers };

export async function getJson(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  injectedFetch?: FetchLike,
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
  if (!response.ok) return { status: response.status };
  return { status: response.status, body: await response.json() };
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<{ body: unknown; bytes: number }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError(`response_oversized:${declared}`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new RangeError(`response_oversized:${bytes.byteLength}`);
    return { body: JSON.parse(new TextDecoder().decode(bytes)), bytes: bytes.byteLength };
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
  return { body: JSON.parse(new TextDecoder().decode(bytes)), bytes: total };
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
  if (!response.ok) return { status: response.status, headers: response.headers };
  const parsed = await readBoundedJson(response, maxResponseBytes);
  return { status: response.status, body: parsed.body, bytes: parsed.bytes, headers: response.headers };
}
