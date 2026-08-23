export type StandaloneConnection = {
  origin: string;
  token?: string;
  cleanURL: string;
};

type LocationLike = {
  protocol: string;
  hostname: string;
  origin: string;
  hash: string;
  pathname: string;
  search: string;
};

export function standaloneConnection(location: LocationLike): StandaloneConnection | undefined {
  if (location.protocol !== "http:" || location.hostname !== "127.0.0.1") return undefined;
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  return {
    origin: location.origin,
    ...(/^[A-Za-z0-9_-]{32,}$/.test(token) ? { token } : {}),
    cleanURL: `${location.pathname}${location.search}`,
  };
}

export class LocalInspectorClient {
  constructor(
    private readonly origin: string,
    private readonly token?: string,
    private readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  snapshot<T>(): Promise<T> {
    return this.call<T>("/api/snapshot");
  }

  inspect<T>(x: number, y: number): Promise<T> {
    return this.call<T>("/api/inspect", {
      method: "POST",
      body: JSON.stringify({ x, y }),
    });
  }

  saveReview<T>(selectedViewID: string, note: string): Promise<T> {
    return this.call<T>("/api/review", {
      method: "POST",
      body: JSON.stringify({ selectedViewID, note }),
    });
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(new URL(path, this.origin), {
      ...init,
      cache: "no-store",
      credentials: this.token ? "omit" : "same-origin",
      headers: {
        Accept: "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload = (await response.json()) as { error?: unknown } & T;
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`);
    }
    return payload;
  }
}
