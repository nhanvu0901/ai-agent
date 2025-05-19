import { QdrantClient } from '@qdrant/js-client-rest';
import config from '../config/config';
import { SearchResultItem, QdrantPayload } from '../types';
import { OpenAIEmbeddings } from "@langchain/openai"; // Using Langchain's OpenAI for embeddings
import { AzureOpenAIEmbeddings } from "@langchain/azure-openai"; // Add Azure OpenAI embeddings

// Qdrant client instance
let qdrantClient: QdrantClient | undefined;
let embeddings: OpenAIEmbeddings | AzureOpenAIEmbeddings | undefined;

const QDRANT_COLLECTION_NAME = 'legal_documents'; // Define your collection name

function getQdrantClient(): QdrantClient {
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ url: config.qdrant.url });
    }
    return qdrantClient;
}

function getEmbeddingsService() {
    if (!embeddings) {
        // Check if Azure OpenAI configuration is available
        if (config.openai.azureEndpoint && config.openai.apiKey && config.openai.azureApiVersion) {
            console.log("Using Azure OpenAI for embeddings");
            embeddings = new AzureOpenAIEmbeddings({
                azureOpenAIApiKey: config.openai.apiKey,
                azureOpenAIEndpoint: config.openai.azureEndpoint,
                apiVersion: config.openai.azureApiVersion,
                deploymentName: config.agent.embeddingModel
            });
        } else {
            console.log("Using regular OpenAI for embeddings");
            embeddings = new OpenAIEmbeddings({
                openAIApiKey: config.openai.apiKey,
                modelName: "text-embedding-ada-002", // Or your preferred embedding model
            });
        }
    }
    return embeddings;
}

/**
 * Generates an embedding for a given text.
 */
async function generateEmbedding(text: string): Promise<number[]> {
    const embeddingsService = getEmbeddingsService();
    try {
        // The API is the same for both OpenAIEmbeddings and AzureOpenAIEmbeddings
        const vector = await embeddingsService.embedQuery(text);
        return vector;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw new Error('Failed to generate text embedding.');
    }
}

export function isQdrantPayload(payload: any): payload is QdrantPayload {
    return (
        payload &&
        typeof payload.text === 'string' &&
        typeof payload.law_id === 'string' &&
        typeof payload.full_path === 'string'
    );
}

export async function searchSimilarVectors(
    queryText: string,
    collectionName: string = QDRANT_COLLECTION_NAME,
    limit: number = 5,
    scoreThreshold?: number
): Promise<SearchResultItem[]> {
    const client = getQdrantClient();
    try {
        // Ensure limit is an integer (similar fix as in Neo4j service)
        const intLimit = Math.floor(limit);

        const queryVector = await generateEmbedding(queryText);

        const searchResult = await client.search(collectionName, {
            vector: queryVector,
            limit: intLimit,
            score_threshold: scoreThreshold,
            with_payload: true,
        });

        const mappedResults: (SearchResultItem | null)[] = searchResult.map(
            (point): SearchResultItem | null => {
                if (isQdrantPayload(point.payload)) {
                    const payload = point.payload;

                    const item: SearchResultItem = {
                        id: point.id.toString(),
                        score: point.score,
                        type: 'vector',
                        content: payload.text,
                        title: payload.title || `Document chunk ${point.id}`,
                        law_id: payload.law_id,
                        full_path: payload.full_path,
                        metadata: {
                            ...payload,
                            qdrant_id: point.id,
                        },
                    };
                    return item;
                } else {
                    console.warn('Received Qdrant point with unexpected payload structure:', point);
                    return null;
                }
            }
        );

        return mappedResults.filter((item): item is SearchResultItem => item !== null);

    } catch (error) {
        console.error('Error searching Qdrant:', error);
        if (error instanceof Error && error.message.includes("Not found: Collection")) {
            console.warn(`Qdrant collection "${collectionName}" not found. Ensure it's created and populated.`);
        }
        return [];
    }
}

/**
 * Function to create Qdrant collection if it doesn't exist.
 */
export async function ensureQdrantCollection(
    collectionName: string = QDRANT_COLLECTION_NAME,
    vectorSize: number = 1536, // For text-embedding-ada-002
    distance: "Cosine" | "Euclid" | "Dot" = "Cosine"
): Promise<void> {
    const client = getQdrantClient();
    try {
        const collections = await client.getCollections();
        const collectionExists = collections.collections.some(c => c.name === collectionName);

        if (!collectionExists) {
            console.log(`Collection "${collectionName}" does not exist. Creating...`);
            await client.createCollection(collectionName, {
                vectors: {
                    size: vectorSize,
                    distance: distance,
                },
            });
            console.log(`Collection "${collectionName}" created successfully.`);
        } else {
            console.log(`Collection "${collectionName}" already exists.`);
        }
    } catch (error) {
        console.error(`Error ensuring Qdrant collection "${collectionName}":`, error);
    }
}