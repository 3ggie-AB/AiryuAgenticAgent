import { glob } from "glob";
import pLimit from "p-limit";
import { join } from "path";
import type { WorkerResult } from "../types";
import { parseFile } from "../indexer/parser";
import chalk from "chalk";

const SUPPORTED_EXTENSIONS = [
  "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
  "**/*.go", "**/*.py", "**/*.rs",
];

const IGNORED_DIRS = [
  "node_modules/**", ".git/**", "dist/**", "build/**",
  "coverage/**", ".next/**", "__pycache__/**", "vendor/**",
];

// ── Worker ────────────────────────────────────────────────────

export interface WorkerConfig {
  workerId: number;
  directory: string;
  rootDir: string;
  concurrency?: number;
}

export async function runWorker(config: WorkerConfig): Promise<WorkerResult> {
  const { workerId, directory, rootDir, concurrency = 10 } = config;
  const start = Date.now();

  // Collect all source files
  const patterns = SUPPORTED_EXTENSIONS.map((ext) => join(directory, ext));
  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      ignore: IGNORED_DIRS,
      absolute: true,
    });
    files.push(...matches);
  }

  if (files.length === 0) {
    return {
      workerId,
      directory,
      nodes: [],
      edges: [],
      files: [],
      duration: Date.now() - start,
    };
  }

  console.log(chalk.cyan(`  [Worker ${workerId}] Processing ${files.length} files in ${directory}`));

  // Parse files with concurrency limit
  const limit = pLimit(concurrency);
  const results = await Promise.all(
    files.map((filePath) =>
      limit(async () => {
        try {
          return parseFile(filePath, rootDir);
        } catch {
          return null;
        }
      })
    )
  );

  const validResults = results.filter(Boolean) as NonNullable<typeof results[0]>[];

  const allNodes = validResults.flatMap((r) => r!.nodes);
  const allEdges = validResults.flatMap((r) => r!.edges);
  const allFiles = validResults.map((r) => r!.file);

  console.log(
    chalk.green(
      `  [Worker ${workerId}] Done — ${allFiles.length} files, ${allNodes.length} nodes, ${allEdges.length} edges (${Date.now() - start}ms)`
    )
  );

  return {
    workerId,
    directory,
    nodes: allNodes,
    edges: allEdges,
    files: allFiles,
    duration: Date.now() - start,
  };
}

// ── Parallel Worker Manager ───────────────────────────────────

export interface WorkerManagerConfig {
  rootDir: string;
  workerDirs?: string[];
  maxWorkers?: number;
}

export async function runParallelWorkers(config: WorkerManagerConfig): Promise<WorkerResult[]> {
  const { rootDir, maxWorkers = 8 } = config;

  // Auto-detect directories if not specified
  let dirs = config.workerDirs;
  if (!dirs || dirs.length === 0) {
    dirs = await detectWorkerDirs(rootDir, maxWorkers);
  }

  console.log(chalk.yellow(`\n🚀 Starting ${dirs.length} parallel workers...\n`));
  dirs.forEach((dir, i) => {
    console.log(chalk.gray(`  Worker ${i + 1} → ${dir.replace(rootDir, ".")}`));
  });
  console.log("");

  // Run all workers in parallel
  const workerPromises = dirs.map((dir, idx) =>
    runWorker({
      workerId: idx + 1,
      directory: dir,
      rootDir,
      concurrency: 10,
    })
  );

  const results = await Promise.all(workerPromises);
  return results;
}

// ── Directory Detector ────────────────────────────────────────

async function detectWorkerDirs(rootDir: string, maxWorkers: number): Promise<string[]> {
  // Find top-level directories with source files
  const topLevelDirs = await glob("*/", {
    cwd: rootDir,
    absolute: true,
    ignore: IGNORED_DIRS.map((p) => p.replace("/**", "")),
  });

  if (topLevelDirs.length === 0) {
    return [rootDir];
  }

  // If we have fewer dirs than max workers, use them directly
  if (topLevelDirs.length <= maxWorkers) {
    return topLevelDirs;
  }

  // Otherwise, take the first N dirs
  return topLevelDirs.slice(0, maxWorkers);
}

// ── Merge Results ─────────────────────────────────────────────

export function mergeWorkerResults(results: WorkerResult[]) {
  const allNodes = results.flatMap((r) => r.nodes);
  const allEdges = results.flatMap((r) => r.edges);
  const allFiles = results.flatMap((r) => r.files);

  // Deduplicate nodes by ID
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  // Resolve edge references
  const resolvedEdges = allEdges.filter((e) => {
    if (e.to.startsWith("__ref__:")) {
      const refName = e.to.replace("__ref__:", "");
      const target = allNodes.find((n) => n.name === refName);
      if (target) {
        e.to = target.id;
        e.weight = 1.0;
        return true;
      }
      return false; // Drop unresolved external refs
    }
    return true;
  });

  return {
    nodes: Array.from(nodeMap.values()),
    edges: resolvedEdges,
    files: allFiles,
    stats: {
      totalWorkers: results.length,
      totalFiles: allFiles.length,
      totalNodes: nodeMap.size,
      totalEdges: resolvedEdges.length,
      totalDuration: Math.max(...results.map((r) => r.duration)),
    },
  };
}
