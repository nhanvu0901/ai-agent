import OpenAI from 'openai';
import config from '../config/config';
import { LLMCallTrace, SearchResultItem } from '../types';

// Azure SDK imports
import { OpenAIClient } from '@azure/openai';
import { AzureKeyCredential } from '@azure/core-auth';

let openai: OpenAI | undefined;
let azureClient: OpenAIClient | undefined;

/**
 * Get the appropriate OpenAI client
 * This function will either return a regular OpenAI client or an Azure-configured client
 * based on the available configuration
 */
function getOpenAIClient(): OpenAI | OpenAIClient {
    // If Azure configuration is available
    if (config.openai.azureEndpoint && config.openai.apiKey) {
        console.log("Using Azure OpenAI client");
        if (!azureClient) {
            azureClient = new OpenAIClient(
                config.openai.azureEndpoint,
                new AzureKeyCredential(config.openai.apiKey)
            );
        }
        return azureClient;
    }
    // Fallback to regular OpenAI
    else {
        console.log("Using regular OpenAI client");
        if (!openai) {
            if (!config.openai.apiKey) {
                throw new Error('OPENAI_API_KEY is not configured. Please set it in your .env file.');
            }
            openai = new OpenAI({
                apiKey: config.openai.apiKey,
            });
        }
        return openai;
    }
}

interface OpenAICompletionParams {
    prompt: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    systemMessage?: string;
}

interface OpenAICompletionResponse {
    content: string | null;
    llmTrace: LLMCallTrace;
}

/**
 * Generates a text completion using OpenAI's API
 * Works with both regular OpenAI and Azure OpenAI
 */
export async function getOpenAICompletion({
                                              prompt,
                                              model = config.agent.model,
                                              max_tokens = 1000,
                                              temperature = 0.7,
                                              systemMessage = "You are a helpful assistant.",
                                          }: OpenAICompletionParams): Promise<OpenAICompletionResponse> {
    const client = getOpenAIClient();
    const startTime = new Date();
    let responseContent: string | null = null;
    let errorMsg: string | undefined;

    try {
        const messages = [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt }
        ];

        // Check which client we're using
        if (client === azureClient && azureClient) {
            // Azure OpenAI
            const deploymentName = model;
            const completion = await azureClient.getChatCompletions(
                deploymentName,
                messages as any, // Type coercion needed here since Azure SDK has slightly different typing
                {
                    maxTokens: max_tokens,
                    temperature: temperature
                }
            );
            responseContent = completion.choices[0]?.message?.content || null;
        }
        else if (client === openai && openai) {
            // Regular OpenAI
            const completion = await openai.chat.completions.create({
                model: model,
                messages: messages as any,
                max_tokens: max_tokens,
                temperature: temperature,
            });
            responseContent = completion.choices[0]?.message?.content || null;
        }
    } catch (error) {
        console.error('Error calling OpenAI/Azure API:', error);
        errorMsg = error instanceof Error ? error.message : String(error);
    }

    const llmTrace: LLMCallTrace = {
        prompt: systemMessage ? `System: ${systemMessage}\nUser: ${prompt}` : `User: ${prompt}`,
        response: responseContent,
        model: model,
        timestamp: startTime.toISOString(),
        error: errorMsg,
    };

    return { content: responseContent, llmTrace };
}

/**
 * Analyzes a user query to determine intent, extract keywords, or classify
 */
interface QueryAnalysisResult {
    keywords: string[];
    isPotentiallyIrrelevant: boolean;
    intent?: string;
    llmTrace?: LLMCallTrace;
}

export async function analyzeQueryWithOpenAI(query: string): Promise<QueryAnalysisResult> {
    const systemMessage = `You are an expert legal query analyzer. Your task is to analyze the user's question about law.
  1. Extract key terms or entities relevant for searching legal documents.
  2. Determine if the question is clearly off-topic (e.g., asking about weather, sports, personal advice not related to law).
  3. Briefly identify the user's likely intent (e.g., seeking definition, procedure, penalty, comparison).

  Respond in JSON format with the following fields: "keywords" (array of strings), "isPotentiallyIrrelevant" (boolean), "intent" (string).
  For example:
  User: "What are the requirements for electronic signatures in commercial contracts?"
  {
    "keywords": ["electronic signatures", "requirements", "commercial contracts"],
    "isPotentiallyIrrelevant": false,
    "intent": "seeking requirements"
  }
  User: "How is the weather today?"
  {
    "keywords": ["weather"],
    "isPotentiallyIrrelevant": true,
    "intent": "off-topic query"
  }`;
    const prompt = `User query: "${query}"`;

    const { content, llmTrace } = await getOpenAICompletion({
        prompt,
        systemMessage,
        model: config.agent.model,
        temperature: 0.2,
        max_tokens: 200,
    });

    let analysis: QueryAnalysisResult = {
        keywords: query.split(" ").filter(k => k.length > 2),
        isPotentiallyIrrelevant: false,
        intent: "unknown",
        llmTrace,
    };

    if (content) {
        try {
            const parsedContent = JSON.parse(content);
            analysis = {
                keywords: parsedContent.keywords || analysis.keywords,
                isPotentiallyIrrelevant: parsedContent.isPotentiallyIrrelevant !== undefined
                    ? parsedContent.isPotentiallyIrrelevant
                    : false,
                intent: parsedContent.intent || analysis.intent,
                llmTrace,
            };
        } catch (e) {
            console.error("Failed to parse query analysis from LLM:", e, "LLM Raw:", content);
            if (analysis.llmTrace) analysis.llmTrace.error = "Failed to parse LLM JSON response.";
        }
    }
    return analysis;
}

/**
 * Generates a final answer based on the user's query and retrieved context
 */
export async function generateAnswerWithOpenAI(
    originalQuery: string,
    contextSnippets: SearchResultItem[],
    maxTokens: number = 1500,
    model: string = config.agent.model
): Promise<OpenAICompletionResponse> {
    if (contextSnippets.length === 0) {
        return {
            content: "I could not find specific information related to your query in the available legal documents.",
            llmTrace: {
                prompt: originalQuery,
                response: "No context provided to LLM.",
                model: model,
                timestamp: new Date().toISOString(),
                error: "No context snippets available for answer generation."
            }
        };
    }

    const systemMessage = `You are a helpful legal assistant AI. Your task is to answer the user's question based *only* on the provided context from legal documents.
Be concise and informative. If the context doesn't directly answer the question, say that you cannot find the specific information in the provided documents.
Do not make up information or answer from your general knowledge.
Cite the source (e.g., law_id, paragraph, or title) for key pieces of information if available in the context metadata. Format citations like [Source: law_id, full_path].
If multiple sources support a point, you can list them or choose the most relevant.
Structure your answer clearly. Use bullet points if appropriate for lists or multiple requirements.`;

    let promptContext = "Context from legal documents:\n";
    contextSnippets.forEach((item, index) => {
        promptContext += `\n[Source Document ${index + 1}: Law ID: ${item.law_id || 'N/A'}, Path: ${item.full_path || item.id}, Title: ${item.title || 'N/A'}]\nContent: ${item.content}\n`;
    });

    const prompt = `${promptContext}\n\nUser Question: "${originalQuery}"\n\nAnswer directly based on the provided context:`;

    return getOpenAICompletion({
        prompt,
        systemMessage,
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
    });
}