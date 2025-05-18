// src/services/qdrantService.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import config from '../config/config';
import { SearchResultItem, QdrantPayload } from '../types';
import { OpenAIEmbeddings } from "@langchain/openai"; // Using Langchain's OpenAI for embeddings

// Qdrant client instance
let qdrantClient: QdrantClient | undefined;
let embeddings: OpenAIEmbeddings | undefined;

const QDRANT_COLLECTION_NAME = 'legal_documents'; // Define your collection name

function getQdrantClient(): QdrantClient {
    if (!qdrantClient) {
        qdrantClient = new QdrantClient({ url: config.qdrant.url });
    }
    return qdrantClient;
}

function getEmbeddingsService(): OpenAIEmbeddings {
    if (!embeddings) {
        embeddings = new OpenAIEmbeddings({
            openAIApiKey: config.openai.apiKey,
            modelName: "text-embedding-ada-002", // Or your preferred embedding model
        });
    }
    return embeddings;
}

/**
 * Generates an embedding for a given text.
 */
async function generateEmbedding(text: string): Promise<number[]> {
    const embeddingsService = getEmbeddingsService();
    try {
        const vector = await embeddingsService.embedQuery(text);
        return vector;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw new Error('Failed to generate text embedding.');
    }
}

/**
 * Searches Qdrant collection for similar vectors.
 * Assumes your Qdrant points have a payload structure matching QdrantPayload.
 */
export async function searchSimilarVectors(
    queryText: string,
    collectionName: string = QDRANT_COLLECTION_NAME,
    limit: number = 5,
    scoreThreshold?: number
): Promise<SearchResultItem[]> {
    const client = getQdrantClient();
    try {
        const queryVector = await generateEmbedding(queryText);

        const searchResult = await client.search(collectionName, {
            vector: queryVector,
            limit: limit,
            score_threshold: scoreThreshold, // Optional: Minimum similarity score
            with_payload: true, // To retrieve the payload along with the vector
            // with_vector: false // Usually not needed for the result
        });

        return searchResult.map(point => {
            const payload = point.payload as QdrantPayload; // Cast to your defined payload type
            return {
                id: point.id.toString(), // Qdrant ID can be number or UUID
                score: point.score,
                type: 'vector', // Indicates the source of this result
                content: payload.text, // The original text from the payload
                title: payload.title || `Document chunk ${point.id}`,
                law_id: payload.law_id,
                full_path: payload.full_path,
                metadata: {
                    ...payload, // Include all other payload data in metadata
                    qdrant_id: point.id,
                },
            };
        });
    } catch (error) {
        console.error('Error searching Qdrant:', error);
        // If it's a "Not found" error for the collection, you might want to log it differently
        if (error instanceof Error && error.message.includes("Not found: Collection")) {
            console.warn(`Qdrant collection "${collectionName}" not found. Ensure it's created and populated.`);
        }
        return [];
    }
}

/**
 * (Optional) Function to create Qdrant collection if it doesn't exist.
 * You would typically run this once during setup or in a separate script.
 * The vector size depends on your embedding model (e.g., text-embedding-ada-002 uses 1536).
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
        // It might fail if Qdrant is not reachable, handle appropriately
    }
}

// Example of how you might add points (vectors) to Qdrant.
// This would typically be part of your data ingestion pipeline, not the agent's runtime.
/*
import { PointStruct } from '@qdrant/js-client-rest';

export async function addLegalDocumentChunkToQdrant(
  id: string | number, // Unique ID for the point
  textChunk: string,
  payload: QdrantPayload,
  collectionName: string = QDRANT_COLLECTION_NAME
): Promise<void> {
  const client = getQdrantClient();
  try {
    const vector = await generateEmbedding(textChunk);
    const point: PointStruct = {
      id: id,
      vector: vector,
      payload: payload,
    };
    await client.upsert(collectionName, { points: [point] });
    console.log(`Upserted point ${id} to Qdrant collection "${collectionName}".`);
  } catch (error) {
    console.error(`Error upserting point ${id} to Qdrant:`, error);
  }
}
*/

// Call ensureQdrantCollection on startup if you want the app to create it.
// However, it's often better to manage schema/collection creation separately.
// ensureQdrantCollection().catch(console.error);
