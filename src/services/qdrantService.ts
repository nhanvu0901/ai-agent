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
        const queryVector = await generateEmbedding(queryText);

        const searchResult = await client.search(collectionName, {
            vector: queryVector,
            limit: limit,
            score_threshold: scoreThreshold,
            with_payload: true,
        });

        const mappedResults: (SearchResultItem | null)[] = searchResult.map(
          (point): SearchResultItem | null => { // Explicitly define the return type of the map callback
              if (isQdrantPayload(point.payload)) {
                  // Inside this block, point.payload is correctly typed as QdrantPayload
                  // due to the type guard.
                  const payload = point.payload;

                  // Construct an object that explicitly matches the SearchResultItem interface
                  const item: SearchResultItem = {
                      id: point.id.toString(),
                      score: point.score, // point.score (number) is assignable to SearchResultItem.score (number | undefined)
                      type: 'vector',     // 'vector' is one of the allowed literal types for SearchResultItem.type
                      content: payload.text,
                      // payload.title can be undefined. If it is, the fallback makes title a string.
                      // This is compatible with SearchResultItem.title (string | undefined).
                      title: payload.title || `Document chunk ${point.id}`,
                      law_id: payload.law_id,
                      full_path: payload.full_path,
                      metadata: { // This structure is compatible with Record<string, any>
                          ...payload, // Spread all properties from QdrantPayload
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

        // The filter with the type predicate will now work correctly
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
