export type RequestKind =
  | "explain-selection"
  | "summarize-file"
  | "repo-question";

export interface QueryRequest {
  requestId: string;
  requestKind: RequestKind;
  prompt: string;
  workspaceId?: string;
  activeFile?: string;
  selectionText?: string;
  selectionHash?: string;
  languageId?: string;
  gitRevision?: string;
  modelId: string;
  forceFresh: boolean;
}

export type QueryResponse = ReuseResponse | MissResponse;

export interface ReuseResponse {
  decision: "reused";
  answer: string;
  reason: "exact_match" | "semantic_match";
  confidence: number;
  sourceRequestId: string;
}

export interface MissResponse {
  decision: "miss";
  reason: string;
}

export interface StoreRequest {
  query: QueryRequest;
  answer: string;
  modelId: string;
  latencyMs: number;
  source: "live";
}

export interface StoreResponse {
  stored: boolean;
}
