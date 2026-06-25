import chokidar from "chokidar";
import { EventEmitter } from "events";
import type { FileChangeEvent } from "../types";
import { deleteFileData, upsertFiles, upsertNodes, upsertEdges } from "../graph/database";
import { parseFile } from "../indexer/parser";
import chalk from "chalk";

// ── Event System ──────────────────────────────────────────────

export class FileChangeEventSystem extends EventEmitter {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private rootDir: string;
  private processingQueue: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 300;

  constructor(rootDir: string) {
    super();
    this.rootDir = rootDir;
  }

  start(): void {
    console.log(chalk.cyan(`\n👁  Watching for file changes in ${this.rootDir}...`));

    this.watcher = chokidar.watch(this.rootDir, {
      ignored: [
        /(^|[\/\\])\../,
        /node_modules/,
        /\.git/,
        /dist\//,
        /build\//,
        /\.db$/,
      ],
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on("add", (filePath) => this.handleChange({ type: "add", filePath, timestamp: Date.now() }))
      .on("change", (filePath) => this.handleChange({ type: "change", filePath, timestamp: Date.now() }))
      .on("unlink", (filePath) => this.handleChange({ type: "unlink", filePath, timestamp: Date.now() }))
      .on("error", (err) => console.error(chalk.red("[Watcher] Error:"), err));
  }

  stop(): void {
    this.watcher?.close();
  }

  private handleChange(event: FileChangeEvent): void {
    // Debounce rapid changes
    const existing = this.processingQueue.get(event.filePath);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.processingQueue.delete(event.filePath);
      this.processEvent(event);
    }, this.DEBOUNCE_MS);

    this.processingQueue.set(event.filePath, timeout);
  }

  private async processEvent(event: FileChangeEvent): Promise<void> {
    const { type, filePath } = event;

    console.log(chalk.yellow(`\n📁 File ${type}: ${filePath.replace(this.rootDir, ".")}`));

    try {
      if (type === "unlink") {
        // File deleted — remove from graph
        await this.handleDelete(filePath);
      } else {
        // File added or changed — re-index
        await this.handleReindex(filePath);
      }
    } catch (err) {
      console.error(chalk.red(`[EventSystem] Error processing ${filePath}:`), err);
    }
  }

  private async handleDelete(filePath: string): Promise<void> {
    const relativePath = filePath.replace(this.rootDir + "/", "");
    deleteFileData(relativePath);
    console.log(chalk.red(`  ✓ Removed from graph: ${relativePath}`));
    this.emit("file:deleted", { filePath: relativePath });
  }

  private async handleReindex(filePath: string): Promise<void> {
    const result = parseFile(filePath, this.rootDir);
    if (!result) return;

    const { file, nodes, edges } = result;

    // Remove old data first
    deleteFileData(file.path);

    // Insert new data
    upsertFiles([file]);
    if (nodes.length > 0) upsertNodes(nodes);
    if (edges.length > 0) upsertEdges(edges);

    console.log(
      chalk.green(
        `  ✓ Re-indexed: ${file.path} (${nodes.length} nodes, ${edges.length} edges)`
      )
    );

    this.emit("file:indexed", { file, nodes, edges });
  }
}

// ── Singleton ─────────────────────────────────────────────────

let _eventSystem: FileChangeEventSystem | null = null;

export function getEventSystem(rootDir?: string): FileChangeEventSystem {
  if (!_eventSystem && rootDir) {
    _eventSystem = new FileChangeEventSystem(rootDir);
  }
  if (!_eventSystem) {
    throw new Error("EventSystem not initialized. Call getEventSystem(rootDir) first.");
  }
  return _eventSystem;
}
