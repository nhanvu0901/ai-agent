// src/services/openAIService.ts
import OpenAI from 'openai';
import config from '../config/config';
import { LLMCallTrace, SearchResultItem } from '../types'; // Assuming SearchResultItem is correctly defined
let openai: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
    if (!openai) {
        if (!config.openai.apiKey) {
            throw new Error('OPENAI_API_KEY is not configured. Please set it in your .env file.');
        }
        // Check if Azure configuration is present
        if (config.openai.azureEndpoint && config.openai.azureApiVersion) {
            console.log("Initializing OpenAI client for Azure");
            openai = new OpenAI({
                apiKey: config.openai.apiKey, // This is your AZURE_API_KEY
                baseURL: config.openai.azureEndpoint, // Use the Azure endpoint
                defaultQuery: { 'api-version': config.openai.azureApiVersion }, // Pass the API version
                defaultHeaders: { 'api-key': config.openai.apiKey }, // Required for Azure
            });
        } else {
            // Fallback to standard OpenAI if Azure config is missing (optional, or throw error)
            console.warn('Azure OpenAI configuration (endpoint, apiVersion) not found. Attempting to initialize standard OpenAI client.');
            openai = new OpenAI({
                apiKey: config.openai.apiKey,
            });
        }
    }
    return openai;
}

interface OpenAICompletionParams {
    prompt: string;
    model?: string; // This will be your Azure deployment name
    max_tokens?: number;
    temperature?: number;
    systemMessage?: string;
}

interface OpenAICompletionResponse {
    content: string | null;
    llmTrace: LLMCallTrace;
}

export async function getOpenAICompletion({
                                              prompt,
                                              model = config.agent.model, // Use model from config (Azure deployment name)
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
            model: model, // This should be your Azure deployment ID (e.g., "gpt-4o-mini")
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

// ... (analyzeQueryWithOpenAI and generateAnswerWithOpenAI functions)
// Ensure the 'model' parameter in these functions also defaults to or uses config.agent.model
// which should be your Azure deployment name.

/**
 * Analyzes the user query to determine intent, extract keywords, or classify.
 */
interface QueryAnalysisResult {
    keywords: string[];
    isPotentiallyIrrelevant: boolean;
    intent?: string;
    llmTrace?: LLMCallTrace;
}

export async function analyzeQueryWithOpenAI(query: string): Promise<QueryAnalysisResult> {
    const systemMessage = `You are an expert legal query analyzer...`; // Keep your existing system message
    const prompt = `User query: "${query}"`;

    const { content, llmTrace } = await getOpenAICompletion({
        prompt,
        systemMessage,
        model: config.agent.model, // Use chat model deployment from config
        temperature: 0.2,
        max_tokens: 200,
    });

    // ... rest of the function remains the same
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
  contextSnippets: SearchResultItem[], // Ensure SearchResultItem is defined or imported
  maxTokens: number = 1500,
  model: string = config.agent.model // Use chat model deployment from config
): Promise<OpenAICompletionResponse> {
    // ... rest of the function remains the same
    // Ensure this function also uses the model name from config (Azure deployment name)
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

    const systemMessage = `You are a helpful legal assistant AI...`; // Keep your system message

    let promptContext = "Context from legal documents:\n";
    contextSnippets.forEach((item, index) => {
        promptContext += `\n[Source Document ${index + 1}: Law ID: ${item.law_id || 'N/A'}, Path: ${item.full_path || item.id}, Title: ${item.title || 'N/A'}]\nContent: ${item.content}\n`;
    });

    const prompt = `${promptContext}\n\nUser Question: "${originalQuery}"\n\nAnswer directly based on the provided context:`;

    return getOpenAICompletion({
        prompt,
        systemMessage,
        model, // This will be your Azure Deployment ID for chat
        max_tokens: maxTokens,
        temperature: 0.3,
    });
}

