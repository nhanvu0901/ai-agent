// src/services/openAIService.ts
import OpenAI from 'openai';
import config from '../config/config';
import { LLMCallTrace,SearchResultItem } from '../types';
import { AzureOpenAI } from 'openai'; // Import AzureOpenAI


let azureOpenaiClient: AzureOpenAI | undefined;

function getOpenAIClient(): AzureOpenAI {
    if (!azureOpenaiClient) {
        if (!config.openai.apiKey) { // Or however you name it in your config
            throw new Error('AZURE_OPENAI_API_KEY is not configured.');
        }
        if (!config.openai.azureEndpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT is not configured.');
        }
        if (!config.openai.azureApiVersion) {
            throw new Error('AZURE_OPENAI_API_VERSION is not configured.');
        }

        azureOpenaiClient = new AzureOpenAI({
            apiKey: config.openai.apiKey,
            endpoint: config.openai.azureEndpoint, // Corrected parameter name based on typical SDKs
            apiVersion: config.openai.azureApiVersion, // Corrected parameter name
        });
    }
    return azureOpenaiClient;
}

interface OpenAICompletionParams {
    prompt: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    systemMessage?: string; // Optional system message for chat models
}

interface OpenAICompletionResponse {
    content: string | null;
    llmTrace: LLMCallTrace;
}

/**
 * Generates a text completion using OpenAI's API.
 * Prefers chat completion endpoint.
 */
export async function getOpenAICompletion({
                                              prompt,
                                              model = "gpt-4o-mini", // Default to a cost-effective chat model
                                              max_tokens = 1000,
                                              temperature = 0.7,
                                              systemMessage = "You are a helpful assistant.",
                                          }: OpenAICompletionParams): Promise<OpenAICompletionResponse> {
    const client = getOpenAIClient();
    const startTime = new Date();
    let responseContent: string | null = null;
    let errorMsg: string | undefined;

    try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
        if (systemMessage) {
            messages.push({ role: "system", content: systemMessage });
        }
        messages.push({ role: "user", content: prompt });

        const completion = await client.chat.completions.create({
            model: model,
            messages: messages,
            max_tokens: max_tokens,
            temperature: temperature,
        });
        responseContent = completion.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
        console.error('Error calling OpenAI API:', error);
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
 * Analyzes the user query to determine intent, extract keywords, or classify.
 * This is a placeholder for more sophisticated query understanding.
 */
interface QueryAnalysisResult {
    keywords: string[];
    isPotentiallyIrrelevant: boolean;
    intent?: string; // e.g., "definition", "requirements", "comparison"
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
        model: "gpt-4o-mini", // Cheaper model for analysis
        temperature: 0.2,
        max_tokens: 200,
    });

    let analysis: QueryAnalysisResult = {
        keywords: query.split(" ").filter(k => k.length > 2), // Fallback basic keywords
        isPotentiallyIrrelevant: false, // Default to relevant
        intent: "unknown",
        llmTrace,
    };

    if (content) {
        try {
            const parsedContent = JSON.parse(content);
            analysis = {
                keywords: parsedContent.keywords || analysis.keywords,
                isPotentiallyIrrelevant: parsedContent.isPotentiallyIrrelevant !== undefined ? parsedContent.isPotentiallyIrrelevant : false,
                intent: parsedContent.intent || analysis.intent,
                llmTrace,
            };
        } catch (e) {
            console.error("Failed to parse query analysis from LLM:", e, "LLM Raw:", content);
            // Keep fallback analysis
            if (analysis.llmTrace) analysis.llmTrace.error = "Failed to parse LLM JSON response.";
        }
    }
    return analysis;
}


/**
 * Generates a final answer based on the user's query and retrieved context.
 */
export async function generateAnswerWithOpenAI(
    originalQuery: string,
    contextSnippets: SearchResultItem[],
    maxTokens: number = 1500,
    model: string = "gpt-4o-mini" // Use a capable model for generation
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
        if (item.metadata) {
            // promptContext += `Metadata: ${JSON.stringify(item.metadata)}\n`;
        }
    });

    const prompt = `${promptContext}\n\nUser Question: "${originalQuery}"\n\nAnswer directly based on the provided context:`;

    return getOpenAICompletion({
        prompt,
        systemMessage,
        model,
        max_tokens: maxTokens,
        temperature: 0.3, // Lower temperature for factual answers
    });
}
