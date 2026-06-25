import chalk from "chalk";
import ora from "ora";
import { runParallelWorkers, mergeWorkerResults } from "../workers/pool";
import { upsertFiles, upsertNodes, upsertEdges, saveStats, getStats } from "../graph/database";
import type { IndexStats } from "../types";

export interface IndexOptions {
  rootDir: string;
  workerDirs?: string[];
  maxWorkers?: number;
  watch?: boolean;
}

// ── Main Indexer ──────────────────────────────────────────────

export async function indexProject(options: IndexOptions): Promise<IndexStats> {
  const { rootDir, maxWorkers = 6 } = options;
  const start = Date.now();

  console.log(chalk.bold.blue("\n╔══════════════════════════════════════╗"));
  console.log(chalk.bold.blue("║   PROJECT KNOWLEDGE ENGINE  v1.0.0   ║"));
  console.log(chalk.bold.blue("╚══════════════════════════════════════╝\n"));
  console.log(chalk.gray(`Root directory: ${rootDir}`));
  console.log(chalk.gray(`Max workers:    ${maxWorkers}`));
  console.log(chalk.gray(`Started at:     ${new Date().toLocaleTimeString()}\n`));

  // ── Phase 1: Parallel workers parse the codebase ──────────
  const spinner = ora("Starting parallel workers...").start();
  spinner.stop();

  const workerResults = await runParallelWorkers({
    rootDir,
    workerDirs: options.workerDirs,
    maxWorkers,
  });

  // ── Phase 2: Merge results ────────────────────────────────
  console.log(chalk.yellow("\n📊 Merging results from all workers..."));
  const merged = mergeWorkerResults(workerResults);

  // ── Phase 3: Persist to database ──────────────────────────
  const persistSpinner = ora("Persisting to knowledge graph...").start();

  if (merged.files.length > 0) {
    upsertFiles(merged.files);
  }
  if (merged.nodes.length > 0) {
    // Batch insert in chunks to avoid SQLite limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < merged.nodes.length; i += CHUNK_SIZE) {
      upsertNodes(merged.nodes.slice(i, i + CHUNK_SIZE));
    }
  }
  if (merged.edges.length > 0) {
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < merged.edges.length; i += CHUNK_SIZE) {
      upsertEdges(merged.edges.slice(i, i + CHUNK_SIZE));
    }
  }

  persistSpinner.succeed("Knowledge graph updated");

  // ── Phase 4: Collect stats ────────────────────────────────
  const dbStats = getStats();
  const duration = Date.now() - start;

  // Count languages
  const languages: Record<string, number> = {};
  for (const file of merged.files) {
    languages[file.language] = (languages[file.language] || 0) + 1;
  }

  const stats: IndexStats = {
    totalFiles: dbStats.totalFiles,
    totalNodes: dbStats.totalNodes,
    totalEdges: dbStats.totalEdges,
    languages,
    indexedAt: Date.now(),
    duration,
  };

  saveStats(stats);

  // ── Print Summary ─────────────────────────────────────────
  console.log(chalk.bold.green("\n✅ Indexing complete!\n"));
  console.log(chalk.white("┌─────────────────────────────────┐"));
  console.log(chalk.white(`│ Files indexed:  ${String(stats.totalFiles).padEnd(16)}│`));
  console.log(chalk.white(`│ Nodes created:  ${String(stats.totalNodes).padEnd(16)}│`));
  console.log(chalk.white(`│ Edges mapped:   ${String(stats.totalEdges).padEnd(16)}│`));
  console.log(chalk.white(`│ Duration:       ${String(duration + "ms").padEnd(16)}│`));
  console.log(chalk.white("└─────────────────────────────────┘\n"));

  console.log(chalk.cyan("Languages:"));
  for (const [lang, count] of Object.entries(languages)) {
    console.log(chalk.gray(`  ${lang}: ${count} files`));
  }

  return stats;
}
