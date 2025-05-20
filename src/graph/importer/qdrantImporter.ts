import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereEmbeddings } from './embeddings/cohereEmbeddings';
import { QdrantPayload } from '../../types';
import config from '../../config/config';
import { LawJson, Part, Head, Paragraph, SubsectionLevel1, SubsectionLevel2 } from './types';


type StructuralElement = Part | Head | Paragraph | SubsectionLevel1 | SubsectionLevel2;

export class QdrantImporter {
  private client: QdrantClient;
  private embeddings: CohereEmbeddings;
  private collectionName: string = 'legal_documents';
  private batchSize: number = config.embeddings.batchSize || 20;
  private retryDelay: number = 2000; // milliseconds to wait between retries
  private maxRetries: number = 3; // maximum number of retries for each embedding
  private idCounter: number = 1; // Counter for generating sequential IDs

  constructor() {

    this.client = new QdrantClient({ url: config.qdrant.url });

    console.log("Embedding Configuration:");
    console.log(`  API Key: ${config.embeddings.apiKey ? "Set (length: " + config.embeddings.apiKey.length + ")" : "Not set"}`);
    console.log(`  Model: ${config.embeddings.model}`);

    this.embeddings = new CohereEmbeddings({
      apiKey: config.embeddings.apiKey,
      model: config.embeddings.model,
      batchSize: config.embeddings.batchSize
    });
  }

  async ensureCollection(): Promise<void> {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === this.collectionName);
      console.log(collections.collections[0]);
      if (!exists) {
        console.log(`Creating Qdrant collection: ${this.collectionName}`);
        // Get dimension from Cohere embeddings
        const embeddingSize = this.embeddings.getDimension();

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


  async generateEmbedding(text: string): Promise<number[]> {
    let retries = 0;

    // Truncate text if it's too long
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

        // Wait before retrying, with exponential backoff
        const delay = this.retryDelay * Math.pow(2, retries);
        console.log(`Waiting ${delay}ms before retry ${retries + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }

    // This should never happen with the logic above, but TypeScript needs a return
    throw new Error("Failed to generate embedding: Retry logic failed unexpectedly");
  }

  /**
   * Generate embeddings for multiple texts in batch with queue processing
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // Use Cohere's batch embedding capability
    return await this.embeddings.embedBatch(texts);
  }

  /**
   * Convert a string ID to a numeric ID suitable for Qdrant
   * This uses a hash function to generate a positive integer from a string
   */
  private getNumericId(stringId: string): number {
    // Use the idCounter to generate a sequential ID
    const id = this.idCounter++;
    return id;
  }

  /**
   * Convert QdrantPayload to a plain object that Qdrant accepts
   */
  private convertPayloadToPlainObject(payload: QdrantPayload, originalId: string): Record<string, unknown> {
    // Create a new plain object and copy all properties
    const plainObject: Record<string, unknown> = {
      ...payload,
      original_id: originalId // Store the original string ID in the payload
    };

    // Filter out null/undefined values
    Object.keys(plainObject).forEach(key => {
      if (plainObject[key] === null || plainObject[key] === undefined) {
        delete plainObject[key];
      }
    });

    return plainObject;
  }

  /**
   * Store a batch of text chunks with their embeddings
   */
  async storeTextChunks(textChunks: { id: string, text: string, payload: QdrantPayload }[]): Promise<void> {
    if (textChunks.length === 0) return;

    try {
      // Process in smaller batches to avoid overwhelming the embedding API
      const batchSize = 5; // Smaller batch for embedding API
      const batchResults = [];

      // Process in batches
      for (let i = 0; i < textChunks.length; i += batchSize) {
        const batch = textChunks.slice(i, i + batchSize);
        const texts = batch.map(chunk => chunk.text);

        console.log(`Generating embeddings for batch ${i/batchSize + 1} of ${Math.ceil(textChunks.length/batchSize)}`);
        try {
          // Get embeddings for the entire batch
          const vectors = await this.generateBatchEmbeddings(texts);

          // Prepare points for Qdrant
          const points = batch.map((chunk, index) => {
            // Convert string ID to numeric ID for Qdrant
            const numericId = this.getNumericId(chunk.id);
            // Add original ID to payload
            const plainPayload = this.convertPayloadToPlainObject(chunk.payload, chunk.id);

            return {
              id: numericId,
              vector: vectors[index],
              payload: plainPayload
            };
          });

          batchResults.push(...points);
        } catch (error) {
          console.error(`Error processing batch starting at index ${i}:`, error);
        }


        if (i + batchSize < textChunks.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (batchResults.length === 0) {
        throw new Error("All chunks failed to generate embeddings");
      }

      // Store results in Qdrant
      await this.client.upsert(this.collectionName, {
        points: batchResults
      });

      console.log(`Successfully stored ${batchResults.length}/${textChunks.length} vectors in Qdrant.`);
    } catch (error) {
      console.error('Error storing text chunks in Qdrant:', error);
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      throw new Error(`Failed to store text chunks in Qdrant: ${errorMsg}`);
    }
  }


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


  async lawExists(lawId: string,title:string): Promise<boolean> {
    try {
      const searchResult = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            {
              key: 'law_id',
              match: {
                value: lawId,
              },
            },
            {
              key: 'title',
              match: {
                value: title,
              },
            },
          ],
        },
        limit: 1,
        with_payload: false,
        with_vector: false,
      });
      return searchResult.points.length > 0;
    } catch (error) {
      console.error(`Error checking if law ${lawId} exists:`, error);
      // Depending on how you want to handle errors, you might re-throw or return false
      // For now, let's assume if there's an error, we can't confirm existence,
      // but in a production scenario, you might want more robust error handling.
      return false;
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

    // Check if the law_id already exists
    const exists = await this.lawExists(metadata.law_id,metadata.title);
    if (exists) {
      console.log(`Law ${metadata.law_id} - ${metadata.title} already exists in Qdrant. Skipping.`);
      return;
    }

    console.log(`Creating vector embeddings for Law: ${metadata.law_id} - ${metadata.title}`);

    // Create payloads and collect texts to be embedded
    const chunks: { id: string, text: string, payload: QdrantPayload }[] = [];

    // 1. Add the overall law text
    const lawFullText = text_content.join('\n');
    chunks.push({
      id: `law-${metadata.law_id}`, // This ID should be unique for the law itself
      text: lawFullText,
      payload: {
        text: lawFullText.substring(0, 8000), // Truncate if too long
        law_id: metadata.law_id,
        full_path: metadata.law_id,
        title: metadata.title,
        source_file: metadata.source_file || undefined, // Use undefined instead of null
        type: 'law' // Add a type for the main law document
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
        // Add a delay between batches to avoid overwhelming the API
        if (i + this.batchSize < chunks.length) {
          console.log(`Waiting 5 seconds before processing next batch...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error(`Error processing batch ${Math.floor(i/this.batchSize) + 1}:`, error);
        // Continue with next batch
      }
    }

    console.log(`Vector embedding process completed for Law: ${metadata.law_id}`);
  }
}