// src/routes/ask.ts
// This file will now handle the AI Q&A functionality.

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Static, Type } from '@sinclair/typebox'; // For schema definition
import appConfig from '../config'; // Assuming your config is in ../config
import * as agentService from '../agent/agentService'; // Adjust path if needed
import { QARequest, QAResponsePayload, AgentReasoningTrace, SearchResultItem, AgentStep, LLMCallTrace } from '../types'; // Adjust path if needed

// --- Schemas (can be moved to a central types/schemas file) ---

// Schema for the request body when asking a question
const QaQuerySchema = Type.Object({
  question: Type.String({ minLength: 1, description: 'The user question for the Legal AI Agent.' }),
  sessionId: Type.Optional(Type.String({ description: 'Optional session ID for conversation history.' })),
});
type QaQueryType = Static<typeof QaQuerySchema>;

// Schema for individual search result items (sources)
const SearchResultItemSchema = Type.Object({
  id: Type.String(),
  score: Type.Optional(Type.Number()),
  type: Type.String(), // e.g., 'graph', 'vector', 'law', 'paragraph'
  content: Type.String(),
  title: Type.Optional(Type.String()),
  law_id: Type.Optional(Type.String()),
  full_path: Type.Optional(Type.String()),
  metadata: Type.Object({}, { additionalProperties: true, description: "Other relevant metadata" }),
});

// Schema for a single step in the agent's reasoning trace
const AgentStepSchema = Type.Object({
  step: Type.Number(),
  thought: Type.String(),
  action: Type.String(),
  actionInput: Type.String({ description: "JSON stringified object or simple string" }),
  observation: Type.Optional(Type.String({ description: "JSON stringified object, simple string, or null" })),
  error: Type.Optional(Type.String()),
});

// Schema for LLM call trace
const LLMCallTraceSchema = Type.Object({
  prompt: Type.String(),
  response: Type.Union([Type.String(), Type.Null()]),
  model: Type.String(),
  timestamp: Type.String({ format: 'date-time'}), // Or just Type.String()
  error: Type.Optional(Type.String())
});

// Schema for the agent's full reasoning trace (debug information)
const AgentReasoningTraceSchema = Type.Object({
  sessionId: Type.Optional(Type.String()),
  originalQuery: Type.String(),
  status: Type.String({ description: "'success' | 'error' | 'irrelevant_query' | 'no_results' | 'processing'" }),
  finalAnswer: Type.Optional(Type.String()),
  steps: Type.Array(AgentStepSchema),
  llmCalls: Type.Optional(Type.Array(LLMCallTraceSchema)),
  relevantSources: Type.Optional(Type.Array(SearchResultItemSchema)),
});

// Schema for the main response payload of the /ask endpoint
const QaResponseSchema = Type.Object({
  answer: Type.String(),
  sources: Type.Optional(Type.Array(SearchResultItemSchema)),
  debugInfo: Type.Optional(AgentReasoningTraceSchema), // Included if DEBUG_MODE is true
});

// --- Endpoint Definition ---

export default async function askEndpoint(fastify: FastifyInstance) {
  fastify.post<{ Body: QaQueryType; Reply: QAResponsePayload | { error: string; message: string, statusCode: number } }>(
      // Consider prefixing your API routes, e.g., in your main routes index:
      // fastify.register(askEndpoint, { prefix: '/api/qa' });
      // If you do that, this path would just be '/ask' relative to that prefix.
      // For now, assuming it's directly registered, let's use a more specific path.
      '/api/agent/ask', // Changed from GET to POST and updated path
      {
        schema: {
          description: 'Ask a question to the Legal AI Agent.',
          tags: ['AI Agent Q&A'], // Updated tag
          summary: 'Submit a question and get an answer from the AI agent.',
          body: QaQuerySchema,
          response: {
            200: QaResponseSchema,
            400: Type.Object({ // For client-side errors (e.g., bad request)
              statusCode: Type.Number(),
              error: Type.String(),
              message: Type.String(),
            }),
            500: Type.Object({ // For server-side errors
              statusCode: Type.Number(),
              error: Type.String(),
              message: Type.String(),
            }),
          },
        },
      },
      async (request: FastifyRequest<{ Body: QaQueryType }>, reply: FastifyReply) => {
        const { question, sessionId } = request.body;
        request.log.info({ question, sessionId }, 'Received question for Legal AI Agent');

        if (!appConfig.OPENAI_API_KEY) {
          request.log.error('OpenAI API key is not configured. Agent cannot function.');
          return reply.status(500).send({
            statusCode: 500,
            error: "Configuration Error",
            message: "The AI agent is not properly configured (missing API key). Please contact support."
          });
        }

        try {
          const qaRequest: QARequest = { question, sessionId };
          // The agentService.processQuery handles the core logic
          const result: QAResponsePayload = await agentService.processQuery(qaRequest, request.log);

          return reply.status(200).send(result);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
          request.log.error({ err: error, question }, 'Unhandled error in /api/agent/ask endpoint');
          return reply.status(500).send({
            statusCode: 500,
            error: "Internal Server Error",
            message: `An unexpected error occurred while processing your question: ${errorMessage}`
          });
        }
      }
  );

  // You can add other agent-related utility endpoints here if needed in the future
  // For example, an endpoint to get agent status or clear session (if you implement sessions)
}
