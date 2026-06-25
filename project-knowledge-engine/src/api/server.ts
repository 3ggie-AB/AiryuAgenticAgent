import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

import {
  keywordSearch,
  whoCallsThis,
  getCallChain,
  getImpactAnalysis,
  buildCodeContext,
  generateProjectSummary,
} from "../graph/search";
import {
  getNodeById,
  getNodesByFile,
  getStats,
  searchNodesByName,
} from "../graph/database";
import { queryKnowledge, runMultipleAgents, planRequest } from "../agents/groq";
import type { AgentType } from "../types";

const app = new Hono();

// ── Middleware ────────────────────────────────────────────────

app.use("*", cors());
app.use("*", logger());

// ── Health & Stats ────────────────────────────────────────────

app.get("/", (c) => {
  return c.json({
    name: "Project Knowledge Engine",
    version: "1.0.0",
    status: "running",
    endpoints: [
      "GET  /health",
      "GET  /stats",
      "GET  /summary",
      "POST /search",
      "GET  /node/:id",
      "GET  /file?path=",
      "POST /query",
      "POST /agent",
      "GET  /callers/:name",
      "GET  /callchain/:name",
      "GET  /impact/:name",
    ],
  });
});

app.get("/health", (c) => {
  const stats = getStats();
  return c.json({ status: "ok", ...stats, timestamp: new Date().toISOString() });
});

app.get("/stats", (c) => {
  return c.json(getStats());
});

app.get("/summary", (c) => {
  const summary = generateProjectSummary();
  return c.text(summary);
});

// ── Search ────────────────────────────────────────────────────

app.post(
  "/search",
  zValidator(
    "json",
    z.object({
      query: z.string().min(1),
      limit: z.number().optional().default(20),
      type: z.string().optional(),
    })
  ),
  (c) => {
    const { query, limit } = c.req.valid("json");
    const results = keywordSearch(query, limit);
    return c.json({
      query,
      count: results.length,
      results: results.map((r) => ({
        score: r.score,
        node: {
          id: r.node.id,
          type: r.node.type,
          name: r.node.name,
          filePath: r.node.filePath,
          startLine: r.node.startLine,
          signature: r.node.signature,
        },
      })),
    });
  }
);

// ── Node Operations ───────────────────────────────────────────

app.get("/node/:id", (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const node = getNodeById(id);
  if (!node) return c.json({ error: "Node not found" }, 404);
  return c.json(node);
});

app.get("/file", (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path query param required" }, 400);
  const nodes = getNodesByFile(path);
  return c.json({ path, count: nodes.length, nodes });
});

app.get("/nodes/by-name/:name", (c) => {
  const name = c.req.param("name");
  const nodes = searchNodesByName(name, 10);
  return c.json({ name, count: nodes.length, nodes });
});

// ── Graph Queries ─────────────────────────────────────────────

app.get("/callers/:name", (c) => {
  const name = c.req.param("name");
  const callers = whoCallsThis(name);
  return c.json({
    function: name,
    count: callers.length,
    callers: callers.map((n) => ({
      name: n.name,
      type: n.type,
      filePath: n.filePath,
      startLine: n.startLine,
    })),
  });
});

app.get("/callchain/:name", (c) => {
  const name = c.req.param("name");
  const depth = parseInt(c.req.query("depth") || "3", 10);
  const chain = getCallChain(name, Math.min(depth, 6));
  return c.text(chain);
});

app.get("/impact/:name", (c) => {
  const name = c.req.param("name");
  const analysis = getImpactAnalysis(name);

  if (!analysis.node) {
    return c.json({ error: `Node not found: ${name}` }, 404);
  }

  return c.json({
    node: {
      name: analysis.node.name,
      type: analysis.node.type,
      filePath: analysis.node.filePath,
    },
    impactedFiles: analysis.impactedFiles,
    callGraph: analysis.callGraph,
  });
});

// ── AI Knowledge Query ────────────────────────────────────────

app.post(
  "/query",
  zValidator(
    "json",
    z.object({
      question: z.string().min(1),
      context: z.string().optional(),
      maxResults: z.number().optional().default(10),
    })
  ),
  async (c) => {
    const { question, context, maxResults } = c.req.valid("json");

    // 1. Plan the request
    const plan = await planRequest(question);

    // 2. Search for relevant code
    const searchResults = keywordSearch(
      [...plan.searchTerms, ...question.split(" ").slice(0, 3)].join(" "),
      maxResults
    );
    const relevantNodes = searchResults.map((r) => r.node);

    // 3. Query AI with context
    const answer = await queryKnowledge(
      { question, context, maxResults },
      relevantNodes
    );

    return c.json({
      question,
      plan,
      answer: answer.answer,
      reasoning: answer.reasoning,
      confidence: answer.confidence,
      relevantNodes: answer.relevantNodes.slice(0, 5).map((n) => ({
        name: n.name,
        type: n.type,
        filePath: n.filePath,
        startLine: n.startLine,
      })),
    });
  }
);

// ── Multi-Agent Analysis ──────────────────────────────────────

app.post(
  "/agent",
  zValidator(
    "json",
    z.object({
      query: z.string().min(1),
      agents: z
        .array(
          z.enum(["architecture", "coding", "security", "performance", "testing", "documentation"])
        )
        .optional()
        .default(["coding"]),
      searchQuery: z.string().optional(),
    })
  ),
  async (c) => {
    const { query, agents, searchQuery } = c.req.valid("json");
    const start = Date.now();

    // Find relevant code context
    const searchResults = keywordSearch(searchQuery || query, 15);
    const codeContext = buildCodeContext(searchResults.map((r) => r.node));

    if (!codeContext) {
      return c.json({ error: "No relevant code found for the query" }, 404);
    }

    // Run agents in parallel
    const results = await runMultipleAgents({
      query,
      codeContext,
      agents: agents as AgentType[],
    });

    return c.json({
      query,
      totalDuration: Date.now() - start,
      contextSize: codeContext.length,
      results: results.map((r) => ({
        agent: r.agentType,
        duration: r.duration,
        result: r.result,
      })),
    });
  }
);

// ── Start Server ──────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);

console.log(`\n🚀 Knowledge Engine API starting on port ${PORT}...`);
console.log(`   http://localhost:${PORT}\n`);

export default {
  port: PORT,
  fetch: app.fetch,
};
