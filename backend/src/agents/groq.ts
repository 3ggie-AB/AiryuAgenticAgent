import Groq from "groq-sdk";
import type { AgentType, CodeNode, KnowledgeQuery, KnowledgeAnswer } from "../types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Use llama3 via Groq (fast inference)
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// ── Agent System Prompts ──────────────────────────────────────

const AGENT_PROMPTS: Record<AgentType, string> = {
  architecture: `You are an expert software architect analyzing a codebase.
Your role is to understand system design, module boundaries, dependency flows, and architectural patterns.
Provide clear insights about the overall structure, potential issues, and recommendations.
Be concise and technical. Focus on high-level patterns and relationships.`,

  coding: `You are an expert software engineer reviewing and analyzing code.
Your role is to understand implementation details, code quality, patterns, and suggest improvements.
Provide specific, actionable feedback. Reference exact functions and files when relevant.
Be concise and technical. Focus on correctness, maintainability, and performance.`,

  security: `You are a security engineer auditing a codebase.
Your role is to identify security vulnerabilities, dangerous patterns, exposed secrets, injection risks, and authentication issues.
Be specific about CVEs and security best practices. Rate severity (Critical/High/Medium/Low).
Never skip potential vulnerabilities even if they seem minor.`,

  performance: `You are a performance engineer analyzing code for bottlenecks.
Your role is to identify N+1 queries, memory leaks, inefficient algorithms, blocking operations, and optimization opportunities.
Provide specific optimization suggestions with expected impact.
Be concise and focus on measurable improvements.`,

  testing: `You are a QA engineer reviewing test coverage and quality.
Your role is to identify untested code paths, suggest test cases, review test quality, and find edge cases.
Reference specific functions and modules. Suggest concrete test implementations.
Be specific about what should be tested and how.`,

  documentation: `You are a technical writer reviewing code documentation.
Your role is to identify missing documentation, improve existing docs, and ensure APIs are well-documented.
Suggest specific docstring improvements. Keep documentation clear and accurate.
Be concise and focus on developer experience.`,
};

// ── Core AI Completion ────────────────────────────────────────

export async function complete(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 2048
): Promise<string> {
  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    return response.choices[0]?.message?.content || "";
  } catch (err: any) {
    if (err?.status === 429) {
      // Rate limit — wait and retry once
      await new Promise((r) => setTimeout(r, 2000));
      return complete(systemPrompt, userMessage, maxTokens);
    }
    throw err;
  }
}

// ── Knowledge Query ───────────────────────────────────────────

export async function queryKnowledge(
  query: KnowledgeQuery,
  relevantNodes: CodeNode[]
): Promise<KnowledgeAnswer> {
  const contextStr = relevantNodes
    .slice(0, 10)
    .map(
      (n) =>
        `--- ${n.type.toUpperCase()}: ${n.name} (${n.filePath}:${n.startLine}) ---\n${n.content.substring(0, 500)}`
    )
    .join("\n\n");

  const systemPrompt = `You are a codebase intelligence engine. 
You have deep knowledge of the project's structure, dependencies, and implementation.
Answer questions accurately based on the provided code context.
Always reference specific files and line numbers when relevant.
If the information is not in the context, say so clearly.`;

  const userMessage = `
Question: ${query.question}

${query.context ? `Additional context: ${query.context}\n` : ""}
Relevant code context:
${contextStr || "No relevant code found."}

Provide:
1. A direct answer to the question
2. Key findings and evidence
3. Confidence level (0-100%)
4. Any caveats or limitations

Format as:
ANSWER: <your answer>
REASONING: <your reasoning>
CONFIDENCE: <0-100>
`;

  const response = await complete(systemPrompt, userMessage, 1024);

  // Parse response
  const answerMatch = response.match(/ANSWER:\s*([\s\S]*?)(?=REASONING:|$)/);
  const reasoningMatch = response.match(/REASONING:\s*([\s\S]*?)(?=CONFIDENCE:|$)/);
  const confidenceMatch = response.match(/CONFIDENCE:\s*(\d+)/);

  return {
    answer: answerMatch?.[1]?.trim() || response,
    relevantNodes,
    reasoning: reasoningMatch?.[1]?.trim() || "",
    confidence: parseInt(confidenceMatch?.[1] || "50", 10),
  };
}

// ── Multi-Agent Execution ─────────────────────────────────────

export async function runAgent(
  agentType: AgentType,
  query: string,
  codeContext: string
): Promise<string> {
  const systemPrompt = AGENT_PROMPTS[agentType];
  const userMessage = `
Analyze the following code:

${codeContext}

Task: ${query}

Provide a focused, technical analysis.`;

  return complete(systemPrompt, userMessage, 2048);
}

// ── Parallel Agent Execution ──────────────────────────────────

export interface MultiAgentConfig {
  query: string;
  codeContext: string;
  agents: AgentType[];
}

export interface MultiAgentResult {
  agentType: AgentType;
  result: string;
  duration: number;
}

export async function runMultipleAgents(config: MultiAgentConfig): Promise<MultiAgentResult[]> {
  const { query, codeContext, agents } = config;

  // Run all agents in parallel (Groq is fast enough for this)
  const agentPromises = agents.map(async (agentType): Promise<MultiAgentResult> => {
    const start = Date.now();
    try {
      const result = await runAgent(agentType, query, codeContext);
      return { agentType, result, duration: Date.now() - start };
    } catch (err) {
      return {
        agentType,
        result: `Agent failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        duration: Date.now() - start,
      };
    }
  });

  return Promise.all(agentPromises);
}

// ── Embedding Generation ──────────────────────────────────────
// Simple TF-IDF-like embedding using Groq's understanding

export async function generateSummaryEmbedding(content: string): Promise<string> {
  const response = await complete(
    "You are a code summarizer. Create a 2-sentence technical summary of the code provided. Be precise and focus on what the code does and its role.",
    content.substring(0, 1000),
    150
  );
  return response;
}

// ── Request Planner ───────────────────────────────────────────

export async function planRequest(userQuery: string): Promise<{
  intent: string;
  requiredAgents: AgentType[];
  searchTerms: string[];
  strategy: string;
}> {
  const systemPrompt = `You are a request planner for a codebase intelligence system.
Given a user query, determine:
1. The intent (what they want to know)
2. Which agents to use (architecture/coding/security/performance/testing/documentation)
3. Search terms to find relevant code
4. Strategy for answering

Respond in JSON format only.`;

  const userMessage = `User query: "${userQuery}"

Respond with JSON:
{
  "intent": "...",
  "requiredAgents": ["coding"],
  "searchTerms": ["keyword1", "keyword2"],
  "strategy": "..."
}`;

  const response = await complete(systemPrompt, userMessage, 512);

  try {
    const cleaned = response.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      intent: userQuery,
      requiredAgents: ["coding"],
      searchTerms: userQuery.split(" ").slice(0, 3),
      strategy: "Direct search and analysis",
    };
  }
}
