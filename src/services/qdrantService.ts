// src/services/qdrantService.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import config from '../config/config';
import { SearchResultItem, QdrantPayload } from '../types';
import { CohereEmbeddings } from '../graph/embeddings/cohereEmbeddings';

// Qdrant client instance
let qdrantClient: QdrantClient | undefined;
let embeddings: CohereEmbeddings | undefined;

const QDRANT_COLLECTION_NAME = 'legal_documents'; // Define your collection name
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

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


export async function ensureQdrantCollection(collectionName: string = QDRANT_COLLECTION_NAME): Promise<boolean> {
    const client = getQdrantClient();
    try {
        // Check if collection exists
        const collections = await client.getCollections();
        console.log("Available Qdrant collections:", collections.collections.map(c => c.name));

        const exists = collections.collections.some(c => c.name === collectionName);

        if (!exists) {
            console.log(`Collection "${collectionName}" does not exist in Qdrant.`);
            return false;
        } else {
            const collInfo = await client.getCollection(collectionName);
            console.log(`Collection "${collectionName}" info:`, JSON.stringify({
                vectorsCount: collInfo.vectors_count,
                vectorSize: collInfo.config?.params?.vectors?.size,
                distance: collInfo.config?.params?.vectors?.distance
            }));

            if (collInfo.vectors_count === 0) {
                console.warn(`Collection "${collectionName}" exists but contains 0 vectors.`);
            }

            return true;
        }
    } catch (error) {
        console.error('Error checking Qdrant collection:', error);
        return false;
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
        const collectionExists = await ensureQdrantCollection(collectionName);
        if (!collectionExists) {
            console.error(`Collection "${collectionName}" does not exist. Cannot perform search.`);
            return [];
        }

        // Ensure limit is an integer
        const intLimit = Math.floor(limit);

        console.log(`Generating embedding for search query: "${queryText.substring(0, 50)}..."`);
        const queryVector = await generateEmbedding(queryText);
        console.log(`Successfully generated embedding vector of length ${queryVector.length}`);

        // First try with score threshold if provided
        if (scoreThreshold !== undefined && scoreThreshold > 0) {
            try {
                const searchParams = {
                    vector: queryVector,
                    limit: intLimit,
                    with_payload: true,
                    score_threshold: scoreThreshold
                };

                console.log(`Searching Qdrant collection "${collectionName}" with params:`,
                    { limit: intLimit, score_threshold: scoreThreshold });

                const searchResult = await client.search(collectionName, searchParams);
                console.log(`Search with threshold ${scoreThreshold} returned ${searchResult.length} results`);

                // If we got results, process them
                if (searchResult.length > 0) {
                    return processSearchResults(searchResult);
                }

                // If no results with threshold, we'll try without threshold below
                console.log(`No results with score threshold ${scoreThreshold}, trying without threshold...`);
            } catch (thresholdError) {
                console.error('Error during threshold search:', thresholdError);
                // Fall through to non-threshold search
            }
        }

        // Try without score threshold if we got here
        const searchParams = {
            vector: queryVector,
            limit: intLimit,
            with_payload: true
        };

        console.log(`Searching Qdrant collection "${collectionName}" without score threshold`);

        const searchResult = await client.search(collectionName, searchParams);
        console.log(`Search without threshold returned ${searchResult.length} results`);

        if (searchResult.length === 0) {
            // If still no results, try with a smaller vector sample to confirm the API is working
            console.log("Testing with a minimal search to check if Qdrant is responsive...");
            const testResult = await client.search(collectionName, {
                vector: queryVector,
                limit: 1,
                with_payload: true
            });

            if (testResult.length === 0) {
                console.warn("Qdrant test search also returned 0 results. Possible issues:");
                console.warn("1. Collection may be empty");
                console.warn("2. The embedding model may differ from what was used during indexing");
                console.warn("3. There might be a connection or configuration issue");
            } else {
                console.log("Test search succeeded but main search returned no results.");
            }
        }

        return processSearchResults(searchResult);
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

function processSearchResults(searchResult: any[]): SearchResultItem[] {
    // Map results to SearchResultItem type
    const mappedResults: SearchResultItem[] = [];

    for (const point of searchResult) {
        console.log(`Processing search result point with id: ${point.id}, score: ${point.score}`);

        // Log full payload for debugging
        if (config.debugMode) {
            console.log(`Full payload for point ${point.id}:`, JSON.stringify(point.payload));
        }

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
            console.warn('Received Qdrant point with unexpected payload structure:',
                JSON.stringify(point.payload || {}));
        }
    }

    return mappedResults;
}