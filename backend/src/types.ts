// ============================================================
// Core Types for Project Knowledge Engine
// ============================================================

export interface CodeNode {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  signature?: string;
  docComment?: string;
  embedding?: number[];
}

export type NodeType =
  | "function"
  | "struct"
  | "interface"
  | "class"
  | "method"
  | "route"
  | "middleware"
  | "database_query"
  | "env_usage"
  | "api_call"
  | "test"
  | "import"
  | "export";

export interface CodeEdge {
  from: string;
  to: string;
  relation: EdgeRelation;
  weight?: number;
}

export type EdgeRelation =
  | "calls"
  | "imports"
  | "implements"
  | "extends"
  | "uses"
  | "depends_on"
  | "tested_by"
  | "routes_to";

export interface FileInfo {
  path: string;
  language: Language;
  size: number;
  lastModified: number;
  hash: string;
}

export type Language = "typescript" | "javascript" | "go" | "python" | "rust" | "unknown";

export interface WorkerResult {
  workerId: number;
  directory: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
  files: FileInfo[];
  duration: number;
}

export interface KnowledgeQuery {
  question: string;
  context?: string;
  maxResults?: number;
}

export interface KnowledgeAnswer {
  answer: string;
  relevantNodes: CodeNode[];
  reasoning: string;
  confidence: number;
}

export interface AgentTask {
  id: string;
  type: AgentType;
  query: string;
  context?: Record<string, unknown>;
}

export interface AgentResult {
  taskId: string;
  agentType: AgentType;
  result: string;
  metadata: Record<string, unknown>;
  duration: number;
}

export type AgentType =
  | "architecture"
  | "coding"
  | "security"
  | "performance"
  | "testing"
  | "documentation";

export interface IndexStats {
  totalFiles: number;
  totalNodes: number;
  totalEdges: number;
  languages: Record<string, number>;
  indexedAt: number;
  duration: number;
}

export interface FileChangeEvent {
  type: "add" | "change" | "unlink";
  filePath: string;
  timestamp: number;
}

export interface GraphSearchResult {
  node: CodeNode;
  score: number;
  path?: CodeNode[];
}
