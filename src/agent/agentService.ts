
import config from '../config/config';
import {
    AgentReasoningTrace,
    AgentStep,
    QARequest,
    LLMCallTrace,
    QAResponsePayload
} from '../types';

import * as openAIService from '../services/openAIService';
import * as retrievalService from '../services/retrievalService';
import { FastifyLoggerInstance } from 'fastify';

const MAX_AGENT_STEPS = 5; // Prevent infinite loops

interface AgentContext {
    originalQuery: string;
    sessionId?: string;
    currentStep: number;
    trace: AgentReasoningTrace;
    logger: FastifyLoggerInstance;
}

function initializeTrace(query: string, sessionId?: string): AgentReasoningTrace {
    return {
        originalQuery: query,
        sessionId,
        status: 'processing',
        steps: [],
        llmCalls: [],
        relevantSources: [],
    };
}

function addStepToTrace(trace: AgentReasoningTrace, thought: string, action: string, actionInput: any, observation: any = null, error?: string): AgentStep {
    const stepNum = trace.steps.length + 1;
    const agentStep: AgentStep = {
        step: stepNum,
        thought,
        action,
        actionInput: typeof actionInput === 'string' ? actionInput : JSON.stringify(actionInput),
        observation: observation ? (typeof observation === 'string' ? observation : JSON.stringify(observation)) : null,
        error,
    };
    trace.steps.push(agentStep);
    if (config.debugMode) {
        console.log(`[Agent Step ${stepNum}]`);
        console.log(`  Thought: ${thought}`);
        console.log(`  Action: ${action}`);
        console.log(`  Action Input: ${agentStep.actionInput}`);
        if (observation) console.log(`  Observation: ${agentStep.observation}`);
        if (error) console.error(`  Error: ${error}`);
    }
    return agentStep;
}

function addLlmCallToTrace(trace: AgentReasoningTrace, llmCall: LLMCallTrace) {
    if (!trace.llmCalls) {
        trace.llmCalls = [];
    }
    trace.llmCalls.push(llmCall);
}


export async function processQuery(
    request: QARequest,
    logger: FastifyLoggerInstance
): Promise<QAResponsePayload> {
    const agentCtx: AgentContext = {
        originalQuery: request.question,
        sessionId: request.sessionId,
        currentStep: 0,
        trace: initializeTrace(request.question, request.sessionId),
        logger,
    };

    try {
        // Step 1: Analyze Query (Relevance & Basic Keywords)
        addStepToTrace(agentCtx.trace, "Analyzing user query for relevance and keywords.", "analyzeQueryWithOpenAI", { query: agentCtx.originalQuery });
        const analysisResult = await openAIService.analyzeQueryWithOpenAI(agentCtx.originalQuery);

        agentCtx.trace.steps[agentCtx.trace.steps.length - 1].observation = JSON.stringify(analysisResult);
        if (analysisResult.llmTrace) addLlmCallToTrace(agentCtx.trace, analysisResult.llmTrace);


        if (analysisResult.isPotentiallyIrrelevant) {
            agentCtx.trace.status = 'irrelevant_query';
            const answer = "I am a legal assistant AI. It seems your question is not related to legal matters. Could you please ask a question about Czech law?";
            agentCtx.trace.finalAnswer = answer;
            addStepToTrace(agentCtx.trace, "Query deemed irrelevant.", "finish", { answer });
            return {
                answer,
                debugInfo: config.debugMode ? agentCtx.trace : undefined,
            };
        }
        const keywordsForSearch = analysisResult.keywords.join(' ') || agentCtx.originalQuery;


        // Step 2: Perform Hybrid Search
        const thoughtSearch = `Query analyzed as relevant (intent: ${analysisResult.intent}). Performing hybrid search with keywords: "${keywordsForSearch}".`;
        addStepToTrace(agentCtx.trace, thoughtSearch, "hybridSearch", { query: keywordsForSearch, useGraph: true, useVector: true });

        const searchResults = await retrievalService.hybridSearch({
            query: keywordsForSearch,
            useGraph: true, // Enable both by default for hybrid
            useVector: true,
        });


        agentCtx.trace.steps[agentCtx.trace.steps.length - 1].observation = JSON.stringify(searchResults);
        agentCtx.trace.relevantSources = searchResults;


        if (!searchResults || searchResults.length === 0) {
            agentCtx.trace.status = 'no_results';
            const answer = "I couldn't find any specific documents related to your query. Please try rephrasing or being more specific.";
            agentCtx.trace.finalAnswer = answer;
            addStepToTrace(agentCtx.trace, "No results found from hybrid search.", "finish", { answer });
            return {
                answer,
                sources: [],
                debugInfo: config.debugMode ? agentCtx.trace : undefined,
            };
        }

        // Step 3: Generate Answer based on retrieved context
        const thoughtGenerate = "Context retrieved. Generating a comprehensive answer using LLM.";
        addStepToTrace(agentCtx.trace, thoughtGenerate, "generateAnswerWithOpenAI", { originalQuery: agentCtx.originalQuery, contextLength: searchResults.length });

        const { content: finalAnswer, llmTrace: generationLlmTrace } = await openAIService.generateAnswerWithOpenAI(
            agentCtx.originalQuery,
            searchResults
        );
        if (generationLlmTrace) addLlmCallToTrace(agentCtx.trace, generationLlmTrace);

        if (!finalAnswer) {
            agentCtx.trace.status = 'error';
            agentCtx.trace.steps[agentCtx.trace.steps.length - 1].error = "LLM failed to generate an answer.";
            const answer = "I encountered an issue while trying to formulate an answer. Please try again.";
            agentCtx.trace.finalAnswer = answer;
            return {
                answer,
                sources: searchResults,
                debugInfo: config.debugMode ? agentCtx.trace : undefined,
            };
        }

        agentCtx.trace.steps[agentCtx.trace.steps.length - 1].observation = JSON.stringify({ answer: finalAnswer });
        agentCtx.trace.status = 'success';
        agentCtx.trace.finalAnswer = finalAnswer;
        addStepToTrace(agentCtx.trace, "Final answer generated.", "finish", { answer: finalAnswer });


        // Step 4: (Future) Validate Answer - self-critique using LLM
        // For now, we'll skip this.

        return {
            answer: finalAnswer,
            sources: searchResults,
            debugInfo: config.debugMode ? agentCtx.trace : undefined,
        };

    } catch (error) {
        logger.error({ err: error, query: request.question }, 'Error processing query in agent service');
        agentCtx.trace.status = 'error';
        if (agentCtx.trace.steps.length > 0) {
            agentCtx.trace.steps[agentCtx.trace.steps.length -1].error = error instanceof Error ? error.message : String(error);
        } else {
            addStepToTrace(agentCtx.trace, "Initial error before processing.", "error_handler", {}, String(error));
        }
        return {
            answer: 'I encountered an unexpected error while processing your request. Please try again later.',
            debugInfo: config.debugMode ? agentCtx.trace : undefined,
        };
    }
}
