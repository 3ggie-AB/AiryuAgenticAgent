import Database from "better-sqlite3";
import type { CodeNode, CodeEdge, FileInfo, IndexStats } from "../types";
import { join } from "path";

const DB_PATH = process.env.DB_PATH || join(process.cwd(), "data", "knowledge.db");

// Ensure data directory exists
import { mkdirSync } from "fs";
mkdirSync(join(process.cwd(), "data"), { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma("cache_size = 10000");
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      size INTEGER NOT NULL,
      last_modified INTEGER NOT NULL,
      hash TEXT NOT NULL,
      indexed_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      signature TEXT,
      doc_comment TEXT,
      embedding BLOB,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (file_path) REFERENCES files(path)
    );

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_node TEXT NOT NULL,
      to_node TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      FOREIGN KEY (from_node) REFERENCES nodes(id),
      FOREIGN KEY (to_node) REFERENCES nodes(id)
    );

    CREATE TABLE IF NOT EXISTS index_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_files INTEGER,
      total_nodes INTEGER,
      total_edges INTEGER,
      languages TEXT,
      indexed_at INTEGER,
      duration INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);
    CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);
  `);
}

// ── Node Operations ──────────────────────────────────────────

export function upsertNodes(nodes: CodeNode[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO nodes
      (id, type, name, file_path, start_line, end_line, content, signature, doc_comment, embedding)
    VALUES
      (@id, @type, @name, @filePath, @startLine, @endLine, @content, @signature, @docComment, @embedding)
  `);

  const upsertMany = db.transaction((nodes: CodeNode[]) => {
    for (const node of nodes) {
      stmt.run({
        ...node,
        embedding: node.embedding ? Buffer.from(new Float32Array(node.embedding).buffer) : null,
      });
    }
  });

  upsertMany(nodes);
}

export function getNodeById(id: string): CodeNode | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as any;
  if (!row) return null;
  return rowToNode(row);
}

export function getNodesByFile(filePath: string): CodeNode[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM nodes WHERE file_path = ?").all(filePath) as any[];
  return rows.map(rowToNode);
}

export function searchNodesByName(name: string, limit = 10): CodeNode[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM nodes WHERE name LIKE ? LIMIT ?")
    .all(`%${name}%`, limit) as any[];
  return rows.map(rowToNode);
}

export function getAllNodes(type?: string): CodeNode[] {
  const db = getDb();
  const rows = type
    ? (db.prepare("SELECT * FROM nodes WHERE type = ?").all(type) as any[])
    : (db.prepare("SELECT * FROM nodes").all() as any[]);
  return rows.map(rowToNode);
}

// ── Edge Operations ──────────────────────────────────────────

export function upsertEdges(edges: CodeEdge[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO edges (from_node, to_node, relation, weight)
    VALUES (@from, @to, @relation, @weight)
  `);

  const upsertMany = db.transaction((edges: CodeEdge[]) => {
    for (const edge of edges) {
      stmt.run({ from: edge.from, to: edge.to, relation: edge.relation, weight: edge.weight ?? 1.0 });
    }
  });

  upsertMany(edges);
}

export function getCallGraph(nodeId: string, depth = 3): Array<CodeEdge & { fromName: string; toName: string }> {
  const db = getDb();
  const results: Array<CodeEdge & { fromName: string; toName: string }> = [];

  function recurse(id: string, currentDepth: number) {
    if (currentDepth <= 0) return;
    const rows = db.prepare(`
      SELECT e.*, n1.name as fromName, n2.name as toName
      FROM edges e
      JOIN nodes n1 ON e.from_node = n1.id
      JOIN nodes n2 ON e.to_node = n2.id
      WHERE e.from_node = ?
    `).all(id) as any[];

    for (const row of rows) {
      results.push({
        from: row.from_node,
        to: row.to_node,
        relation: row.relation,
        weight: row.weight,
        fromName: row.fromName,
        toName: row.toName,
      });
      recurse(row.to_node, currentDepth - 1);
    }
  }

  recurse(nodeId, depth);
  return results;
}

export function getCallers(nodeId: string): CodeNode[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT n.* FROM nodes n
    JOIN edges e ON e.from_node = n.id
    WHERE e.to_node = ? AND e.relation = 'calls'
  `).all(nodeId) as any[];
  return rows.map(rowToNode);
}

export function getImpactedFiles(nodeId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`
    WITH RECURSIVE deps(node_id) AS (
      SELECT from_node FROM edges WHERE to_node = ?
      UNION ALL
      SELECT e.from_node FROM edges e JOIN deps d ON e.to_node = d.node_id
    )
    SELECT DISTINCT n.file_path FROM nodes n JOIN deps d ON n.id = d.node_id
  `).all(nodeId) as any[];
  return rows.map((r) => r.file_path);
}

// ── File Operations ──────────────────────────────────────────

export function upsertFiles(files: FileInfo[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO files (path, language, size, last_modified, hash)
    VALUES (@path, @language, @size, @lastModified, @hash)
  `);
  const upsertMany = db.transaction((files: FileInfo[]) => {
    for (const f of files) stmt.run(f);
  });
  upsertMany(files);
}

export function getFileByPath(path: string): FileInfo | null {
  const db = getDb();
  return db.prepare("SELECT * FROM files WHERE path = ?").get(path) as FileInfo | null;
}

export function deleteFileData(filePath: string): void {
  const db = getDb();
  const deleteAll = db.transaction(() => {
    const nodeIds = (db.prepare("SELECT id FROM nodes WHERE file_path = ?").all(filePath) as any[]).map(r => r.id);
    for (const id of nodeIds) {
      db.prepare("DELETE FROM edges WHERE from_node = ? OR to_node = ?").run(id, id);
    }
    db.prepare("DELETE FROM nodes WHERE file_path = ?").run(filePath);
    db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
  });
  deleteAll();
}

// ── Stats ────────────────────────────────────────────────────

export function saveStats(stats: IndexStats): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO index_stats (total_files, total_nodes, total_edges, languages, indexed_at, duration)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(stats.totalFiles, stats.totalNodes, stats.totalEdges, JSON.stringify(stats.languages), stats.indexedAt, stats.duration);
}

export function getStats(): { totalNodes: number; totalEdges: number; totalFiles: number } {
  const db = getDb();
  const nodes = (db.prepare("SELECT COUNT(*) as count FROM nodes").get() as any).count;
  const edges = (db.prepare("SELECT COUNT(*) as count FROM edges").get() as any).count;
  const files = (db.prepare("SELECT COUNT(*) as count FROM files").get() as any).count;
  return { totalNodes: nodes, totalEdges: edges, totalFiles: files };
}

// ── Helpers ──────────────────────────────────────────────────

function rowToNode(row: any): CodeNode {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    signature: row.signature,
    docComment: row.doc_comment,
    embedding: row.embedding
      ? Array.from(new Float32Array(row.embedding.buffer || row.embedding))
      : undefined,
  };
}
