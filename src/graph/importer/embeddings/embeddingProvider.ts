// src/graph/importer/embeddings/embeddingProvider.ts
export interface EmbeddingProvider {
    /**
     * Generate an embedding for a single text query
     */
    embedQuery(text: string): Promise<number[]>;

    /**
     * Generate embeddings for multiple texts in a batch
     */
    embedBatch(texts: string[]): Promise<number[][]>;

    /**
     * Get the dimension of the embedding vectors
     */
    getDimension(): number;
}