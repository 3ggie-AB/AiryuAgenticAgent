import { createHash } from "crypto";
import { readFileSync } from "fs";
import { extname, relative } from "path";
import type { CodeNode, CodeEdge, FileInfo, Language, NodeType } from "../types";

// ── Language Detection ────────────────────────────────────────

export function detectLanguage(filePath: string): Language {
  const ext = extname(filePath).toLowerCase();
  const langMap: Record<string, Language> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
    ".py": "python",
    ".rs": "rust",
  };
  return langMap[ext] ?? "unknown";
}

// ── File Parser ───────────────────────────────────────────────

export interface ParseResult {
  file: FileInfo;
  nodes: CodeNode[];
  edges: CodeEdge[];
}

export function parseFile(filePath: string, rootDir: string): ParseResult | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const language = detectLanguage(filePath);
    const hash = createHash("sha256").update(content).digest("hex");
    const stats = Bun.file(filePath);

    const file: FileInfo = {
      path: relative(rootDir, filePath),
      language,
      size: content.length,
      lastModified: Date.now(),
      hash,
    };

    const nodes: CodeNode[] = [];
    const edges: CodeEdge[] = [];

    switch (language) {
      case "typescript":
      case "javascript":
        parseTypeScript(content, file.path, nodes, edges);
        break;
      case "go":
        parseGo(content, file.path, nodes, edges);
        break;
      case "python":
        parsePython(content, file.path, nodes, edges);
        break;
      default:
        parseGeneric(content, file.path, nodes, edges);
    }

    return { file, nodes, edges };
  } catch (err) {
    console.error(`[Parser] Failed to parse ${filePath}:`, err);
    return null;
  }
}

// ── TypeScript/JavaScript Parser ──────────────────────────────

function parseTypeScript(
  content: string,
  filePath: string,
  nodes: CodeNode[],
  edges: CodeEdge[]
): void {
  const lines = content.split("\n");

  // Extract functions
  const funcPatterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/,
    /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\S+)?\s*=>/,
    /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function/,
  ];

  // Extract classes
  const classPattern = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/;

  // Extract interfaces
  const interfacePattern = /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/;

  // Extract type aliases
  const typePattern = /^(?:export\s+)?type\s+(\w+)\s*=/;

  // Extract imports
  const importPattern = /^import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/;

  // Extract Express routes
  const routePattern = /(?:app|router)\.(get|post|put|delete|patch|use)\s*\(\s*['"]([^'"]+)['"]/;

  // Extract env usage
  const envPattern = /process\.env\.(\w+)/g;

  // Extract function calls
  const callPattern = /(\w+)\s*\./g;

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    // Match functions
    for (const pattern of funcPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const name = match[1];
        const endLine = findBlockEnd(lines, idx);
        const blockContent = lines.slice(idx, endLine + 1).join("\n");
        const docComment = extractJsDoc(lines, idx);

        const node: CodeNode = {
          id: `${filePath}:${name}:${lineNum}`,
          type: "function",
          name,
          filePath,
          startLine: lineNum,
          endLine,
          content: blockContent.substring(0, 1000),
          signature: trimmed.substring(0, 200),
          docComment,
        };
        nodes.push(node);

        // Extract calls within function
        extractFunctionCalls(blockContent, node.id, filePath, edges);
        break;
      }
    }

    // Match classes
    const classMatch = trimmed.match(classPattern);
    if (classMatch) {
      const name = classMatch[1];
      const extendsClass = classMatch[2];
      const endLine = findBlockEnd(lines, idx);
      const blockContent = lines.slice(idx, endLine + 1).join("\n");

      const node: CodeNode = {
        id: `${filePath}:${name}:${lineNum}`,
        type: "struct",
        name,
        filePath,
        startLine: lineNum,
        endLine,
        content: blockContent.substring(0, 1000),
        signature: trimmed.substring(0, 200),
      };
      nodes.push(node);

      if (extendsClass) {
        edges.push({ from: node.id, to: `__external__:${extendsClass}`, relation: "extends" });
      }

      // Extract methods
      extractClassMethods(blockContent, filePath, node.id, lineNum, nodes, edges);
    }

    // Match interfaces
    const ifaceMatch = trimmed.match(interfacePattern);
    if (ifaceMatch) {
      const name = ifaceMatch[1];
      const endLine = findBlockEnd(lines, idx);
      const blockContent = lines.slice(idx, endLine + 1).join("\n");

      nodes.push({
        id: `${filePath}:${name}:${lineNum}`,
        type: "interface",
        name,
        filePath,
        startLine: lineNum,
        endLine,
        content: blockContent.substring(0, 800),
        signature: trimmed.substring(0, 200),
      });
    }

    // Match routes
    const routeMatch = trimmed.match(routePattern);
    if (routeMatch) {
      const method = routeMatch[1].toUpperCase();
      const path = routeMatch[2];
      nodes.push({
        id: `${filePath}:route:${method}:${path}:${lineNum}`,
        type: "route",
        name: `${method} ${path}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        content: trimmed,
        signature: `${method} ${path}`,
      });
    }

    // Match imports
    const importMatch = trimmed.match(importPattern);
    if (importMatch) {
      const importedFrom = importMatch[4];
      const importedNames = importMatch[1]
        ? importMatch[1].split(",").map((s) => s.trim().split(" as ")[0].trim())
        : [importMatch[2] || importMatch[3]].filter(Boolean);

      for (const name of importedNames) {
        if (!name) continue;
        edges.push({
          from: `${filePath}:__module__`,
          to: `${importedFrom}:${name}`,
          relation: "imports",
        });
      }
    }

    // Match env usage
    let envMatch;
    const envRegex = /process\.env\.(\w+)/g;
    while ((envMatch = envRegex.exec(line)) !== null) {
      const envVar = envMatch[1];
      nodes.push({
        id: `${filePath}:env:${envVar}:${lineNum}`,
        type: "env_usage",
        name: envVar,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        content: trimmed,
        signature: `process.env.${envVar}`,
      });
    }
  });
}

// ── Go Parser ─────────────────────────────────────────────────

function parseGo(
  content: string,
  filePath: string,
  nodes: CodeNode[],
  edges: CodeEdge[]
): void {
  const lines = content.split("\n");

  const funcPattern = /^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)/;
  const structPattern = /^type\s+(\w+)\s+struct\s*\{/;
  const interfacePattern = /^type\s+(\w+)\s+interface\s*\{/;
  const importPattern = /^\s+"([^"]+)"/;

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    const funcMatch = trimmed.match(funcPattern);
    if (funcMatch) {
      const receiver = funcMatch[2];
      const name = funcMatch[3];
      const endLine = findBlockEnd(lines, idx);
      const blockContent = lines.slice(idx, endLine + 1).join("\n");
      const docComment = extractGoDoc(lines, idx);

      const node: CodeNode = {
        id: `${filePath}:${receiver ? `${receiver}.` : ""}${name}:${lineNum}`,
        type: receiver ? "method" : "function",
        name: receiver ? `${receiver}.${name}` : name,
        filePath,
        startLine: lineNum,
        endLine,
        content: blockContent.substring(0, 1000),
        signature: trimmed.substring(0, 200),
        docComment,
      };
      nodes.push(node);
      extractFunctionCalls(blockContent, node.id, filePath, edges);
    }

    const structMatch = trimmed.match(structPattern);
    if (structMatch) {
      const endLine = findBlockEnd(lines, idx);
      nodes.push({
        id: `${filePath}:${structMatch[1]}:${lineNum}`,
        type: "struct",
        name: structMatch[1],
        filePath,
        startLine: lineNum,
        endLine,
        content: lines.slice(idx, endLine + 1).join("\n").substring(0, 800),
        signature: trimmed,
      });
    }

    const ifaceMatch = trimmed.match(interfacePattern);
    if (ifaceMatch) {
      const endLine = findBlockEnd(lines, idx);
      nodes.push({
        id: `${filePath}:${ifaceMatch[1]}:${lineNum}`,
        type: "interface",
        name: ifaceMatch[1],
        filePath,
        startLine: lineNum,
        endLine,
        content: lines.slice(idx, endLine + 1).join("\n").substring(0, 800),
        signature: trimmed,
      });
    }
  });
}

// ── Python Parser ─────────────────────────────────────────────

function parsePython(
  content: string,
  filePath: string,
  nodes: CodeNode[],
  edges: CodeEdge[]
): void {
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const name = funcMatch[1];
      const endLine = findPythonBlockEnd(lines, idx);
      nodes.push({
        id: `${filePath}:${name}:${lineNum}`,
        type: name.startsWith("test_") ? "test" : "function",
        name,
        filePath,
        startLine: lineNum,
        endLine,
        content: lines.slice(idx, endLine + 1).join("\n").substring(0, 1000),
        signature: trimmed.substring(0, 200),
      });
    }

    const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?/);
    if (classMatch) {
      const endLine = findPythonBlockEnd(lines, idx);
      nodes.push({
        id: `${filePath}:${classMatch[1]}:${lineNum}`,
        type: "struct",
        name: classMatch[1],
        filePath,
        startLine: lineNum,
        endLine,
        content: lines.slice(idx, endLine + 1).join("\n").substring(0, 800),
        signature: trimmed,
      });
    }
  });
}

// ── Generic Parser ────────────────────────────────────────────

function parseGeneric(
  content: string,
  filePath: string,
  nodes: CodeNode[],
  _edges: CodeEdge[]
): void {
  // Minimal fallback for unknown file types
  nodes.push({
    id: `${filePath}:__file__:1`,
    type: "function",
    name: filePath.split("/").pop() || filePath,
    filePath,
    startLine: 1,
    endLine: content.split("\n").length,
    content: content.substring(0, 500),
  });
}

// ── Helpers ───────────────────────────────────────────────────

function findBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let started = false;

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") { depth--; }
    }
    if (started && depth === 0) return i + 1;
    if (i - startIdx > 200) return startIdx + 200; // safety limit
  }
  return Math.min(startIdx + 50, lines.length - 1);
}

function findPythonBlockEnd(lines: string[], startIdx: number): number {
  const baseIndent = (lines[startIdx].match(/^(\s*)/) || ["", ""])[1].length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = (line.match(/^(\s*)/) || ["", ""])[1].length;
    if (indent <= baseIndent) return i;
  }
  return lines.length - 1;
}

function extractJsDoc(lines: string[], funcIdx: number): string | undefined {
  if (funcIdx === 0) return undefined;
  const prevLine = lines[funcIdx - 1].trim();
  if (prevLine.endsWith("*/")) {
    let start = funcIdx - 1;
    while (start >= 0 && !lines[start].trim().startsWith("/**")) start--;
    return lines.slice(start, funcIdx).join("\n");
  }
  return undefined;
}

function extractGoDoc(lines: string[], funcIdx: number): string | undefined {
  const comments: string[] = [];
  let i = funcIdx - 1;
  while (i >= 0 && lines[i].trim().startsWith("//")) {
    comments.unshift(lines[i].trim());
    i--;
  }
  return comments.length > 0 ? comments.join("\n") : undefined;
}

function extractFunctionCalls(
  content: string,
  fromId: string,
  filePath: string,
  edges: CodeEdge[]
): void {
  const callPattern = /(\w+)\s*\(/g;
  const seen = new Set<string>();
  let match;
  
  const keywords = new Set([
    "if", "for", "while", "switch", "catch", "function", "return",
    "new", "typeof", "instanceof", "void", "delete", "await", "yield",
  ]);

  while ((match = callPattern.exec(content)) !== null) {
    const name = match[1];
    if (keywords.has(name) || seen.has(name) || name.length < 2) continue;
    seen.add(name);
    edges.push({
      from: fromId,
      to: `__ref__:${name}`,
      relation: "calls",
      weight: 0.5, // tentative until resolved
    });
  }
}

function extractClassMethods(
  classContent: string,
  filePath: string,
  classId: string,
  classStartLine: number,
  nodes: CodeNode[],
  edges: CodeEdge[]
): void {
  const methodPattern = /^\s+(?:(?:public|private|protected|static|async|override)\s+)*(\w+)\s*\(([^)]*)\)/gm;
  let match;

  while ((match = methodPattern.exec(classContent)) !== null) {
    const name = match[1];
    if (["constructor", "if", "for", "while"].includes(name)) continue;
    const lineOffset = classContent.substring(0, match.index).split("\n").length;

    const methodNode: CodeNode = {
      id: `${filePath}:method:${name}:${classStartLine + lineOffset}`,
      type: "method",
      name,
      filePath,
      startLine: classStartLine + lineOffset,
      endLine: classStartLine + lineOffset + 5,
      content: match[0],
      signature: match[0].trim(),
    };
    nodes.push(methodNode);
    edges.push({ from: classId, to: methodNode.id, relation: "uses" });
  }
}
