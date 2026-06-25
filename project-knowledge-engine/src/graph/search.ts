import {
  getAllNodes,
  getNodeById,
  getCallers,
  getCallGraph,
  getImpactedFiles,
  searchNodesByName,
} from "../graph/database";
import type { CodeNode, GraphSearchResult } from "../types";

// ── Keyword Search ────────────────────────────────────────────

export function keywordSearch(query: string, limit = 20): GraphSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const allNodes = getAllNodes();

  const scored = allNodes.map((node) => {
    let score = 0;
    const searchText =
      `${node.name} ${node.type} ${node.content} ${node.signature || ""} ${node.docComment || ""}`.toLowerCase();

    for (const term of terms) {
      if (node.name.toLowerCase().includes(term)) score += 10;
      if (node.signature?.toLowerCase().includes(term)) score += 5;
      if (node.content.toLowerCase().includes(term)) score += 2;
      if (node.docComment?.toLowerCase().includes(term)) score += 3;
    }

    // Boost by type relevance
    if (node.type === "function" || node.type === "method") score *= 1.2;
    if (node.type === "route") score *= 1.5;

    return { node, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Structural Queries ────────────────────────────────────────

export function whoCallsThis(functionName: string): CodeNode[] {
  const nodes = searchNodesByName(functionName);
  if (nodes.length === 0) return [];

  const callers: CodeNode[] = [];
  for (const node of nodes.slice(0, 3)) {
    callers.push(...getCallers(node.id));
  }

  // Deduplicate
  const seen = new Set<string>();
  return callers.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}

export function getCallChain(functionName: string, depth = 3): string {
  const nodes = searchNodesByName(functionName);
  if (nodes.length === 0) return `No function found with name: ${functionName}`;

  const node = nodes[0];
  const edges = getCallGraph(node.id, depth);

  if (edges.length === 0) {
    return `${node.name} → (no outgoing calls found)`;
  }

  // Build ASCII tree
  const lines: string[] = [`${node.name} (${node.filePath})`];
  const seen = new Set<string>();

  function buildTree(fromId: string, prefix: string, depth: number): void {
    if (depth <= 0) return;
    const children = edges.filter((e) => e.from === fromId && !seen.has(e.to));
    children.forEach((edge, idx) => {
      if (seen.has(edge.to)) return;
      seen.add(edge.to);
      const isLast = idx === children.length - 1;
      lines.push(`${prefix}${isLast ? "└── " : "├── "}${edge.toName} [${edge.relation}]`);
      buildTree(edge.to, prefix + (isLast ? "    " : "│   "), depth - 1);
    });
  }

  buildTree(node.id, "", depth);
  return lines.join("\n");
}

export function getImpactAnalysis(functionOrStructName: string): {
  node: CodeNode | null;
  impactedFiles: string[];
  callGraph: string;
} {
  const nodes = searchNodesByName(functionOrStructName);
  if (nodes.length === 0) {
    return { node: null, impactedFiles: [], callGraph: "Not found" };
  }

  const node = nodes[0];
  const impactedFiles = getImpactedFiles(node.id);
  const callGraph = getCallChain(functionOrStructName, 4);

  return { node, impactedFiles, callGraph };
}

// ── Context Builder ───────────────────────────────────────────

export function buildCodeContext(nodes: CodeNode[], maxLength = 8000): string {
  const parts: string[] = [];
  let totalLength = 0;

  for (const node of nodes) {
    const part = `
=== ${node.type.toUpperCase()}: ${node.name} ===
File: ${node.filePath}:${node.startLine}
${node.docComment ? `Doc: ${node.docComment}\n` : ""}${node.signature ? `Signature: ${node.signature}\n` : ""}
${node.content.substring(0, 600)}
`;
    if (totalLength + part.length > maxLength) break;
    parts.push(part);
    totalLength += part.length;
  }

  return parts.join("\n");
}

// ── Summary Generator ─────────────────────────────────────────

export function generateProjectSummary(): string {
  const nodes = getAllNodes();

  const typeCount = nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const fileCount = new Set(nodes.map((n) => n.filePath)).size;
  const routes = nodes.filter((n) => n.type === "route");
  const functions = nodes.filter((n) => n.type === "function");

  const lines: string[] = [
    "PROJECT KNOWLEDGE SUMMARY",
    "═".repeat(40),
    `Total files:      ${fileCount}`,
    `Total nodes:      ${nodes.length}`,
    "",
    "Node breakdown:",
    ...Object.entries(typeCount).map(([type, count]) => `  ${type}: ${count}`),
    "",
  ];

  if (routes.length > 0) {
    lines.push("API Routes:");
    routes.slice(0, 20).forEach((r) => lines.push(`  ${r.name} (${r.filePath})`));
    if (routes.length > 20) lines.push(`  ... and ${routes.length - 20} more`);
    lines.push("");
  }

  if (functions.length > 0) {
    lines.push(`Top functions (${functions.length} total):`);
    functions.slice(0, 10).forEach((f) => lines.push(`  ${f.name} (${f.filePath}:${f.startLine})`));
    lines.push("");
  }

  return lines.join("\n");
}
