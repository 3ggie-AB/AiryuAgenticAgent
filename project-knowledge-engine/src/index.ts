#!/usr/bin/env bun
import { resolve } from "path";
import chalk from "chalk";

// ── CLI Entry Point ───────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || "help";

async function main() {
  switch (command) {
    case "index": {
      const targetDir = resolve(args[1] || process.cwd());
      const { indexProject } = await import("./indexer/index");
      await indexProject({ rootDir: targetDir, maxWorkers: 6 });
      break;
    }

    case "watch": {
      const targetDir = resolve(args[1] || process.cwd());
      const { indexProject } = await import("./indexer/index");
      const { getEventSystem } = await import("./events/watcher");

      // Initial index
      await indexProject({ rootDir: targetDir });

      // Start watching
      const watcher = getEventSystem(targetDir);
      watcher.start();

      // Keep process alive
      process.on("SIGINT", () => {
        console.log(chalk.yellow("\n\nStopping watcher..."));
        watcher.stop();
        process.exit(0);
      });
      break;
    }

    case "serve": {
      const targetDir = resolve(args[1] || process.cwd());
      process.env.ROOT_DIR = targetDir;
      await import("./api/server");
      break;
    }

    case "query": {
      const question = args.slice(1).join(" ");
      if (!question) {
        console.error(chalk.red("Usage: bun run src/index.ts query <your question>"));
        process.exit(1);
      }

      const { keywordSearch, buildCodeContext } = await import("./graph/search");
      const { queryKnowledge } = await import("./agents/groq");

      console.log(chalk.cyan(`\nQuerying: "${question}"\n`));
      const results = keywordSearch(question, 10);
      const nodes = results.map((r) => r.node);

      if (nodes.length === 0) {
        console.log(chalk.yellow("No relevant code found. Try indexing first."));
        break;
      }

      const answer = await queryKnowledge({ question }, nodes);
      console.log(chalk.bold.green("\n📋 Answer:"));
      console.log(answer.answer);
      console.log(chalk.gray("\n🔍 Reasoning:"));
      console.log(chalk.gray(answer.reasoning));
      console.log(chalk.gray(`\nConfidence: ${answer.confidence}%`));
      break;
    }

    case "agent": {
      const [agentType, ...queryParts] = args.slice(1);
      const query = queryParts.join(" ");

      if (!agentType || !query) {
        console.error(chalk.red("Usage: bun run src/index.ts agent <type> <query>"));
        console.error(chalk.gray("Types: architecture, coding, security, performance, testing, documentation"));
        process.exit(1);
      }

      const { keywordSearch, buildCodeContext } = await import("./graph/search");
      const { runAgent } = await import("./agents/groq");

      console.log(chalk.cyan(`\n🤖 Running ${agentType} agent...\n`));
      const results = keywordSearch(query, 15);
      const context = buildCodeContext(results.map((r) => r.node));
      const result = await runAgent(agentType as any, query, context);

      console.log(chalk.bold.green(`\n📋 ${agentType.toUpperCase()} Agent Report:`));
      console.log(result);
      break;
    }

    case "impact": {
      const name = args[1];
      if (!name) {
        console.error(chalk.red("Usage: bun run src/index.ts impact <function-name>"));
        process.exit(1);
      }

      const { getImpactAnalysis } = await import("./graph/search");
      const analysis = getImpactAnalysis(name);

      if (!analysis.node) {
        console.log(chalk.yellow(`No node found for: ${name}`));
        break;
      }

      console.log(chalk.bold.cyan(`\n📊 Impact Analysis: ${name}\n`));
      console.log(chalk.white("Call Graph:"));
      console.log(analysis.callGraph);

      if (analysis.impactedFiles.length > 0) {
        console.log(chalk.white("\n⚠️  Files that would be impacted:"));
        analysis.impactedFiles.forEach((f) => console.log(chalk.yellow(`  • ${f}`)));
      }
      break;
    }

    case "summary": {
      const { generateProjectSummary } = await import("./graph/search");
      console.log(generateProjectSummary());
      break;
    }

    case "stats": {
      const { getStats } = await import("./graph/database");
      const stats = getStats();
      console.log(chalk.bold.cyan("\n📊 Knowledge Graph Stats:"));
      console.log(chalk.white(`  Files:  ${stats.totalFiles}`));
      console.log(chalk.white(`  Nodes:  ${stats.totalNodes}`));
      console.log(chalk.white(`  Edges:  ${stats.totalEdges}`));
      break;
    }

    default: {
      console.log(chalk.bold.blue("\n🧠 Project Knowledge Engine\n"));
      console.log(chalk.white("Commands:"));
      console.log(chalk.gray("  bun run src/index.ts index [dir]         Index a project"));
      console.log(chalk.gray("  bun run src/index.ts watch [dir]         Index + watch for changes"));
      console.log(chalk.gray("  bun run src/index.ts serve [dir]         Start the API server"));
      console.log(chalk.gray('  bun run src/index.ts query "question"    Ask about the codebase'));
      console.log(chalk.gray("  bun run src/index.ts agent <type> <q>    Run a specific agent"));
      console.log(chalk.gray("  bun run src/index.ts impact <name>       Impact analysis"));
      console.log(chalk.gray("  bun run src/index.ts summary             Project summary"));
      console.log(chalk.gray("  bun run src/index.ts stats               Graph stats\n"));
      console.log(chalk.white("Agent types:"));
      console.log(chalk.gray("  architecture, coding, security, performance, testing, documentation\n"));
      break;
    }
  }
}

main().catch((err) => {
  console.error(chalk.red("\n❌ Error:"), err.message);
  process.exit(1);
});
