import type { QueryRequest, QueryResponse, StoreRequest, StoreResponse } from "./types.js";

export class TokencutClient {
  constructor(private readonly baseUrl: string) {}

  async query(request: QueryRequest): Promise<QueryResponse> {
    const response = await fetch(`${this.baseUrl}/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `tokencut /v1/query responded ${response.status}: ${await response.text()}`
      );
    }

    return (await response.json()) as QueryResponse;
  }

  async store(request: StoreRequest): Promise<StoreResponse> {
    const response = await fetch(`${this.baseUrl}/v1/store`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `tokencut /v1/store responded ${response.status}: ${await response.text()}`
      );
    }

    return (await response.json()) as StoreResponse;
  }

  async isReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
