// src/services/qdrantService.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import config from '../config/config';
import { SearchResultItem, QdrantPayload } from '../types';
import { OpenAIEmbeddings } from "@langchain/openai"; // Using Langchain's OpenAI for embeddings
import { AzureOpenAIEmbeddings } from "@langchain/azure-openai"; // Add Azure OpenAI embeddings

// Qdrant client instance
let qdrantClient: QdrantClient | undefined;
let embeddings: OpenAIEmbeddings | AzureOpenAIEmbeddings | undefined;

const QDRANT_COLLECTION_NAME = 'legal_documents'; // Define your collection name
const MAX_RETRIES = 3; // Maximum number of retries for embedding generation
const RETRY_DELAY = 2000; // Milliseconds to wait between retries

function getQdrantClient(): QdrantClient {
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ url: config.qdrant.url });
    }
    return qdrantClient;
}

function getEmbeddingsService() {
    if (!embeddings) {
        // Check if Azure OpenAI configuration is available
        if (config.openai.azureEndpoint && config.openai.apiKey) {
            console.log("Using Azure OpenAI for embeddings in service");
            embeddings = new AzureOpenAIEmbeddings({
                azureOpenAIApiKey: config.openai.apiKey,
                azureOpenAIEndpoint: config.openai.azureEndpoint,
                // Removed apiVersion parameter as it's not supported
                model: config.agent.embeddingModel
            });
        } else {
            console.log("Using regular OpenAI for embeddings in service");
            embeddings = new OpenAIEmbeddings({
                openAIApiKey: config.openai.apiKey,
                modelName: "text-embedding-ada-002", // Or your preferred embedding model
            });
        }
    }
    return embeddings;
}

/**
 * Generates an embedding for a given text with retry logic.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const embeddingsService = getEmbeddingsService();
    let retries = 0;

    // Truncate text if it's too long (OpenAI embeddings have token limits)
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

    while (retries <= MAX_RETRIES) {
        try {
            const vector = await embeddingsService.embedQuery(truncatedText);
            return vector;
        } catch (error) {
            // Better error handling with detailed logging
            let errorMessage: string;

            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                try {
                    errorMessage = JSON.stringify(error);
                } catch {
                    errorMessage = "Unknown object error";
                }
            } else {
                errorMessage = String(error);
            }

            console.error(`Error generating embedding (attempt ${retries + 1}/${MAX_RETRIES + 1}): ${errorMessage}`);

            // Last retry failed - throw the error
            if (retries === MAX_RETRIES) {
                throw new Error(`Failed to generate embedding after ${MAX_RETRIES + 1} attempts: ${errorMessage}`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            retries++;
        }
    }

    // This should never happen with the logic above, but TypeScript needs a return
    throw new Error("Failed to generate embedding: Retry logic failed unexpectedly");
}

export function isQdrantPayload(payload: any): payload is QdrantPayload {
    return (
      payload &&
      typeof payload.text === 'string' &&
      typeof payload.law_id === 'string' &&
      typeof payload.full_path === 'string'
    );
}

/**
 * Ensures that the Qdrant collection exists
 */
export async function ensureQdrantCollection(collectionName: string = QDRANT_COLLECTION_NAME): Promise<void> {
    const client = getQdrantClient();
    try {
        // Check if collection exists
        const collections = await client.getCollections();
        const exists = collections.collections.some(c => c.name === collectionName);

        if (!exists) {
            console.log(`Creating Qdrant collection: ${collectionName}`);
            // Create collection for embeddings
            // For Azure/OpenAI embedding models, dimension is typically 1536
            const embeddingSize = 1536;

            await client.createCollection(collectionName, {
                vectors: {
                    size: embeddingSize,
                    distance: 'Cosine'
                },
                optimizers_config: {
                    default_segment_number: 2
                }
            });
            console.log(`Qdrant collection ${collectionName} created successfully.`);
        } else {
            console.log(`Qdrant collection ${collectionName} already exists.`);
        }
    } catch (error) {
        console.error('Error ensuring Qdrant collection:', error);
        throw new Error(`Failed to create or verify Qdrant collection: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    }
}

export async function searchSimilarVectors(
  queryText: string,
  collectionName: string = QDRANT_COLLECTION_NAME,
  limit: number = 5,
  scoreThreshold?: number
): Promise<SearchResultItem[]> {
    const client = getQdrantClient();
    try {
        // First, ensure the collection exists
        await ensureQdrantCollection(collectionName);

        // Ensure limit is an integer (similar fix as in Neo4j service)
        const intLimit = Math.floor(limit);

        console.log(`Generating embedding for search query: "${queryText.substring(0, 50)}..."`);
        const queryVector = await generateEmbedding(queryText);
        console.log(`Successfully generated embedding vector of length ${queryVector.length}`);

        const searchParams = {
            vector: queryVector,
            limit: intLimit,
            with_payload: true
        };

        // Add score_threshold only if it's provided
        if (scoreThreshold !== undefined) {
            Object.assign(searchParams, { score_threshold: scoreThreshold });
        }

        console.log(`Searching Qdrant collection "${collectionName}" with params:`,
          { limit: intLimit, withScoreThreshold: scoreThreshold !== undefined });

        const searchResult = await client.search(collectionName, searchParams);
        console.log(`Search returned ${searchResult.length} results`);

        // Map results to SearchResultItem type
        const mappedResults: SearchResultItem[] = [];

        for (const point of searchResult) {
            if (isQdrantPayload(point.payload)) {
                const payload = point.payload;

                // Map the type value - need to ensure it's one of the accepted values
                let itemType: SearchResultItem['type'] = 'vector';
                if (payload.type && ['law', 'part', 'head', 'paragraph', 'subsection', 'vector'].includes(payload.type)) {
                    itemType = payload.type as SearchResultItem['type'];
                }

                mappedResults.push({
                    id: point.id.toString(),
                    score: point.score,
                    type: itemType,
                    content: payload.text,
                    title: payload.title || `Document chunk ${point.id}`,
                    law_id: payload.law_id,
                    full_path: payload.full_path,
                    metadata: {
                        ...payload,
                        qdrant_id: point.id,
                    },
                });
            } else {
                console.warn('Received Qdrant point with unexpected payload structure:', point);
            }
        }

        return mappedResults;
    } catch (error) {
        console.error('Error searching Qdrant:', error);
        // Provide more detailed error for debugging
        const errorMsg = error instanceof Error
          ? error.message
          : (typeof error === 'object' && error !== null
            ? JSON.stringify(error)
            : String(error));

        console.error(`Qdrant search error details: ${errorMsg}`);

        if (errorMsg.includes("Not found: Collection")) {
            console.warn(`Qdrant collection "${collectionName}" not found. Ensure it's created and populated.`);
        }
        return [];
    }
}