// src/services/qdrantService.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import config from '../config/config';
import { SearchResultItem, QdrantPayload } from '../types';
import { CohereEmbeddings } from '../graph/importer/embeddings/cohereEmbeddings';

// Qdrant client instance
let qdrantClient: QdrantClient | undefined;
let embeddings: CohereEmbeddings | undefined;

const QDRANT_COLLECTION_NAME = 'legal_documents'; // Define your collection name
const MAX_RETRIES = 3; // Maximum number of retries for embedding generation
const RETRY_DELAY = 2000; // Milliseconds to wait between retries

function getQdrantClient(): QdrantClient {
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ url: config.qdrant.url });
    }
    return qdrantClient;
}

function getEmbeddingsService(): CohereEmbeddings {
    if (!embeddings) {
        console.log("Initializing Cohere Embeddings for search");
        embeddings = new CohereEmbeddings({
            apiKey: config.embeddings.apiKey,
            model: config.embeddings.model,
            batchSize: config.embeddings.batchSize
        });
    }
    return embeddings;
}

/**
 * Generates an embedding for a given text with retry logic.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const embeddingsService = getEmbeddingsService();
    let retries = 0;

    // Truncate text if it's too long
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

            // Wait before retrying with exponential backoff
            const delay = RETRY_DELAY * Math.pow(2, retries);
            console.log(`Waiting ${delay}ms before retry ${retries + 1}...`);
            await new Promise(resolve => setTimeout(resolve, delay));
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
            const embeddingSize = getEmbeddingsService().getDimension();

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

        // Ensure limit is an integer
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

                // Get the original string ID if available, otherwise use the numeric ID
                const originalId = payload.original_id ? String(payload.original_id) : String(point.id);

                // Map the type value - need to ensure it's one of the accepted values
                let itemType: SearchResultItem['type'] = 'vector';
                if (payload.type && ['law', 'part', 'head', 'paragraph', 'subsection', 'vector'].includes(payload.type)) {
                    itemType = payload.type as SearchResultItem['type'];
                }

                mappedResults.push({
                    id: originalId,
                    score: point.score,
                    type: itemType,
                    content: payload.text,
                    title: payload.title || `Document chunk ${originalId}`,
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