// src/graph/importer/qdrantImporter.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings } from "@langchain/openai";
import { AzureOpenAIEmbeddings } from "@langchain/azure-openai";
import { QdrantPayload } from '../../types';
import config from '../../config/config';
import { LawJson, Part, Head, Paragraph, SubsectionLevel1, SubsectionLevel2 } from './types';

type StructuralElement = Part | Head | Paragraph | SubsectionLevel1 | SubsectionLevel2;

export class QdrantImporter {
  private client: QdrantClient;
  private embeddings: OpenAIEmbeddings | AzureOpenAIEmbeddings;
  private collectionName: string = 'legal_documents';
  private batchSize: number = 20; // Reduced batch size to avoid rate limits
  private retryDelay: number = 2000; // milliseconds to wait between retries
  private maxRetries: number = 3; // maximum number of retries for each embedding

  constructor() {
    // Initialize Qdrant client
    this.client = new QdrantClient({ url: config.qdrant.url });

    // Log the configuration to help with debugging
    console.log("Azure OpenAI Configuration:");
    console.log(`  API Key: ${config.openai.apiKey ? "Set (length: " + config.openai.apiKey.length + ")" : "Not set"}`);
    console.log(`  Endpoint: ${config.openai.azureEndpoint || "Not set"}`);
    console.log(`  API Version: ${config.openai.azureApiVersion || "Not set"}`);
    console.log(`  Embedding Model: ${config.agent.embeddingModel || "Not set"}`);

    // Initialize embeddings service (Azure or regular OpenAI)
    if (config.openai.azureEndpoint && config.openai.apiKey) {
      console.log("Using Azure OpenAI for embeddings");

      // Create Azure OpenAI embeddings with correct parameters
      this.embeddings = new AzureOpenAIEmbeddings({
        azureOpenAIApiKey: config.openai.apiKey,
        azureOpenAIEndpoint: config.openai.azureEndpoint,
        // The apiVersion is not directly supported as a parameter, removed it
        model: config.agent.embeddingModel
      });
    } else {
      console.log("Using regular OpenAI for embeddings");
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: config.openai.apiKey,
        modelName: "text-embedding-ada-002", // Default model
      });
    }
  }

  /**
   * Ensure Qdrant collection exists. Create it if it doesn't.
   */
  async ensureCollection(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);

      if (!exists) {
        console.log(`Creating Qdrant collection: ${this.collectionName}`);
        // Create collection for embeddings
        // For Azure/OpenAI embedding models, dimension is typically 1536
        const embeddingSize = 1536;

        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: embeddingSize,
            distance: 'Cosine'
          },
          optimizers_config: {
            default_segment_number: 2
          }
        });
        console.log(`Qdrant collection ${this.collectionName} created successfully.`);
      } else {
        console.log(`Qdrant collection ${this.collectionName} already exists.`);
      }
    } catch (error) {
      console.error('Error ensuring Qdrant collection:', error);
      throw new Error(`Failed to create or verify Qdrant collection: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    }
  }

  /**
   * Generate embedding for a text with retry logic
   */
  async generateEmbedding(text: string): Promise<number[]> {
    let retries = 0;

    // Truncate text if it's too long (OpenAI embeddings have token limits)
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

    while (retries <= this.maxRetries) {
      try {
        const vector = await this.embeddings.embedQuery(truncatedText);
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

        console.error(`Error generating embedding (attempt ${retries + 1}/${this.maxRetries + 1}): ${errorMessage}`);

        // Last retry failed - throw the error
        if (retries === this.maxRetries) {
          throw new Error(`Failed to generate embedding after ${this.maxRetries + 1} attempts: ${errorMessage}`);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        retries++;
      }
    }

    // This should never happen with the logic above, but TypeScript needs a return
    throw new Error("Failed to generate embedding: Retry logic failed unexpectedly");
  }

  /**
   * Convert QdrantPayload to a plain object that Qdrant accepts
   */
  private convertPayloadToPlainObject(payload: QdrantPayload): Record<string, unknown> {
    // Create a new plain object and copy all properties
    const plainObject: Record<string, unknown> = {};
    for (const key in payload) {
      // Skip any null or undefined values
      if (payload[key as keyof QdrantPayload] != null) {
        plainObject[key] = payload[key as keyof QdrantPayload];
      }
    }
    return plainObject;
  }

  /**
   * Store a batch of text chunks with their embeddings
   */
  async storeTextChunks(textChunks: { id: string, text: string, payload: QdrantPayload }[]): Promise<void> {
    if (textChunks.length === 0) return;

    try {
      // Process each chunk individually to avoid losing an entire batch on failure
      const points = [];

      for (const chunk of textChunks) {
        try {
          console.log(`Generating embedding for chunk: ${chunk.id}`);
          const vector = await this.generateEmbedding(chunk.text);
          const plainPayload = this.convertPayloadToPlainObject(chunk.payload);

          points.push({
            id: chunk.id,
            vector,
            payload: plainPayload
          });
        } catch (error) {
          console.error(`Failed to process chunk ${chunk.id}:`, error);
          // Continue with other chunks instead of failing the entire batch
        }
      }

      if (points.length === 0) {
        throw new Error("All chunks failed to generate embeddings");
      }

      // Store the successful points in Qdrant
      await this.client.upsert(this.collectionName, {
        points
      });

      console.log(`Successfully stored ${points.length}/${textChunks.length} vectors in Qdrant.`);
    } catch (error) {
      console.error('Error storing text chunks in Qdrant:', error);
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      throw new Error(`Failed to store text chunks in Qdrant: ${errorMsg}`);
    }
  }

  /**
   * Map element type to a supported type in QdrantPayload
   */
  private mapElementTypeToPayloadType(elementType: string): QdrantPayload['type'] {
    // Map the element types to types supported in QdrantPayload
    switch (elementType) {
      case 'part':
        return 'part';
      case 'head':
        return 'head';
      case 'paragraph':
        return 'paragraph';
      case 'subsection_level1':
      case 'subsection_level2':
        return 'subsection';
      default:
        return 'vector';
    }
  }

  /**
   * Process a law and create vector embeddings for its content
   */
  async processLaw(lawJson: LawJson): Promise<void> {
    const { metadata, structured_text, text_content } = lawJson;

    if (!metadata.law_id) {
      console.warn('Skipping law for vector embedding due to missing law_id:', metadata.title);
      return;
    }

    console.log(`Creating vector embeddings for Law: ${metadata.law_id} - ${metadata.title}`);

    // Create payloads and collect texts to be embedded
    const chunks: { id: string, text: string, payload: QdrantPayload }[] = [];

    // 1. Add the overall law text
    const lawFullText = text_content.join('\n');
    chunks.push({
      id: `law-${metadata.law_id}`,
      text: lawFullText,
      payload: {
        text: lawFullText.substring(0, 8000), // Truncate if too long
        law_id: metadata.law_id,
        full_path: metadata.law_id,
        title: metadata.title,
        source_file: metadata.source_file || undefined, // Use undefined instead of null
        type: 'law'
      }
    });

    // 2. Process each part, head, paragraph, and subsection
    let chunkCounter = 0;

    // Process structured text recursively to create embeddings
    const processStructuredElements = (elements: StructuralElement[], parentPath = '') => {
      if (!elements || !Array.isArray(elements)) return;

      for (const element of elements) {
        if (element.type && element.identifier) {
          let textContent = '';
          let fullPath = parentPath ? `${parentPath}_${element.type}:${element.identifier}` : `${metadata.law_id}_${element.type}:${element.identifier}`;

          // Extract text content based on element type
          if (element.text) {
            textContent = element.text;
          } else if (element.title) {
            textContent = element.title;
          }

          // Add title if available
          if (element.title && element.text) {
            textContent = `${element.title}\n${element.text}`;
          }

          // Only create vectors for elements with text
          if (textContent && textContent.trim().length > 0) {
            chunkCounter++;

            // Map the element type to a supported type in QdrantPayload
            const payloadType = this.mapElementTypeToPayloadType(element.type);

            chunks.push({
              id: `${metadata.law_id}-chunk-${chunkCounter}`,
              text: textContent,
              payload: {
                text: textContent,
                law_id: metadata.law_id,
                full_path: fullPath,
                title: element.title || metadata.title,
                type: payloadType
              }
            });
          }

          // Process sub-elements recursively
          if ('paragraphs' in element && element.paragraphs) {
            processStructuredElements(element.paragraphs, fullPath);
          }

          if ('heads' in element && element.heads) {
            processStructuredElements(element.heads, fullPath);
          }

          if ('subsections' in element && element.subsections) {
            processStructuredElements(element.subsections, fullPath);
          }
        }
      }
    };

    // Start processing from structured_text
    processStructuredElements(structured_text);

    // Process chunks in batches to avoid API rate limits
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      console.log(`Processing batch ${Math.floor(i/this.batchSize) + 1} of ${Math.ceil(chunks.length/this.batchSize)}, size: ${batch.length}`);
      try {
        await this.storeTextChunks(batch);
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i/this.batchSize) + 1}:`, error);
        // Continue with next batch
      }
    }

    console.log(`Vector embedding process completed for Law: ${metadata.law_id}`);
  }
}