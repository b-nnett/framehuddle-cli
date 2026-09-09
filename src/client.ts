import { setTimeout } from "node:timers/promises";

export function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("The API URL must be an origin without credentials, a path, query, or fragment.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new Error("Use HTTPS, or HTTP on localhost for development.");
  return url.origin;
}

export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(`HTTP ${status}: ${message}`);
  }
}

export class Client {
  readonly origin: string;
  constructor(origin: string, private key: string, private options: {
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<unknown>;
    progress?: (message: string) => void;
  } = {}) {
    this.origin = normalizeOrigin(origin);
    if (!key.trim()) throw new Error("Set FRAMEHUDDLE_API_KEY (or VF_API_KEY) to a key from Settings → API keys.");
  }

  private async response(path: string, method: string, body?: unknown): Promise<Response> {
    // Callers construct paths from encoded IDs; never follow server redirects with credentials.
    if (!/^projects(?:\/|\?|$)/.test(path) || path.split("/").some(part => part === ".." || part === "."))
      throw new Error("Invalid API path.");
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(`${this.origin}/api/v1/${path}`, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          headers: {
            Authorization: `Bearer ${this.key}`,
            ...(body !== undefined ? { "Content-Type": body instanceof Uint8Array
              ? "application/octet-stream" : "application/json" } : {}),
          },
          body: body instanceof Uint8Array ? new Uint8Array(body) : body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new Error("Request failed or timed out. Check the API URL and connection; the request may have reached the server.");
      }
      if (response.status === 429 && attempt < 2) {
        const retry = response.headers.get("retry-after");
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) :
          retry ? (Date.parse(retry) - Date.now()) / 1000 : 60;
        // Do not retry earlier than requested, or wait indefinitely on malformed headers.
        if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 120) {
          await response.body?.cancel();
          this.options.progress?.(`Rate limited; retrying in ${Math.ceil(seconds)}s.`);
          await (this.options.sleep ?? setTimeout)(Math.ceil(seconds * 1000));
          continue;
        }
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        const hint = response.status === 401 ? "Check whether the API key is expired or revoked." :
          response.status === 403 ? "Check the key’s scopes and project restriction." : "Request failed.";
        const message = typeof data.error === "string" ? data.error.replaceAll(this.key, "[redacted]") : hint;
        throw new APIError(response.status, `${message} ${data.error ? hint : ""}`.trim());
      }
      return response;
    }
  }

  async request<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.response(path, method, body);
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch { throw new Error("The API returned an invalid JSON response."); }
  }

  async image(path: string): Promise<Uint8Array> {
    const response = await this.response(path, "GET");
    return new Uint8Array(await response.arrayBuffer());
  }

  async all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: { items: T[]; nextCursor?: string | null } = await this.request(
        path + (cursor ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : ""),
      );
      if (!Array.isArray(page.items) || (page.nextCursor != null && typeof page.nextCursor !== "string"))
        throw new Error("The API returned an invalid collection.");
      items.push(...page.items);
      cursor = page.nextCursor ?? null;
      if (cursor && seen.has(cursor)) throw new Error("The API repeated a pagination cursor.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
}
