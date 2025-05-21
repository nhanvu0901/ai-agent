import { EmbeddingProvider } from './embeddingProvider';

interface CohereEmbeddingsOptions {
    apiKey: string;
    model?: string;
    batchSize?: number;
}

export class CohereEmbeddings implements EmbeddingProvider {
    private apiKey: string;
    private model: string;
    private batchSize: number;
    private cohere: any;

    constructor(options: CohereEmbeddingsOptions) {
        this.apiKey = options.apiKey;
        this.model = options.model || 'embed-multilingual-v3.0';
        this.batchSize = options.batchSize || 20;


        try {
            const { CohereClient } = require('cohere-ai');
            this.cohere = new CohereClient({
                token: this.apiKey
            });
            console.log(`Cohere client initialized with model: ${this.model}`);
        } catch (error) {
            console.error("Failed to initialize Cohere client:", error);
            throw new Error("Cohere initialization failed. Make sure COHERE_API_KEY is set correctly.");
        }
    }

    async embedQuery(text: string): Promise<number[]> {
        try {
            const response: any = await this.cohere.embed({
                texts: [text],
                model: this.model,
                inputType: 'search_query'
            });

            console.log("Received embed response:",
                response && response.embeddings ? "Has embeddings" : "No embeddings");

            if (!response || !response.embeddings) {
                throw new Error("No embeddings in response");
            }

            let embedding: number[] = [];

            if (Array.isArray(response.embeddings) && response.embeddings.length > 0) {
                embedding = response.embeddings[0];
            } else if (typeof response.embeddings === 'object') {
                for (const key in response.embeddings) {
                    if (Array.isArray(response.embeddings[key])) {
                        embedding = response.embeddings[key];
                        break;
                    }
                }
            }

            if (!Array.isArray(embedding) || embedding.length === 0) {
                throw new Error("Could not extract a valid embedding from response");
            }

            return embedding;
        } catch (error) {
            console.error("Error generating Cohere embedding:", error);
            throw error;
        }
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        try {
            const results: number[][] = [];

            for (let i = 0; i < texts.length; i += this.batchSize) {
                const batchTexts = texts.slice(i, i + this.batchSize);

                console.log(`Processing batch ${Math.floor(i/this.batchSize) + 1} with ${batchTexts.length} texts`);

                const response: any = await this.cohere.embed({
                    texts: batchTexts,
                    model: this.model,
                    inputType: 'search_document'
                });

                if (!response || !response.embeddings) {
                    throw new Error(`No embeddings in response for batch starting at index ${i}`);
                }

                const batchResults: number[][] = [];

                if (Array.isArray(response.embeddings)) {
                    for (const embedding of response.embeddings) {
                        if (Array.isArray(embedding)) {
                            batchResults.push(embedding);
                        }
                    }
                } else if (typeof response.embeddings === 'object') {
                    for (let j = 0; j < batchTexts.length; j++) {
                        let found = false;

                        const key = String(j);
                        if (key in response.embeddings && Array.isArray(response.embeddings[key])) {
                            batchResults.push(response.embeddings[key]);
                            found = true;
                        } else {
                            for (const prop in response.embeddings) {
                                if (Array.isArray(response.embeddings[prop]) && batchResults.length < j + 1) {
                                    batchResults.push(response.embeddings[prop]);
                                    found = true;
                                    break;
                                }
                            }
                        }

                        if (!found) {
                            console.warn(`Could not find embedding for text at index ${j} in batch ${Math.floor(i/this.batchSize) + 1}`);
                            batchResults.push([]);
                        }
                    }
                }

                results.push(...batchResults);

                if (i + this.batchSize < texts.length) {
                    console.log(`Waiting 500ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            if (results.length !== texts.length) {
                console.warn(`Warning: Number of embeddings (${results.length}) doesn't match number of input texts (${texts.length})`);
            }

            return results;
        } catch (error) {
            console.error("Error generating Cohere batch embeddings:", error);
            throw error;
        }
    }

    getDimension(): number {
        if (this.model === 'embed-multilingual-v3.0') {
            return 1024;
        }

        if (this.model === 'embed-english-v3.0') {
            return 1024;
        }

        if (this.model === 'embed-english-light-v3.0') {
            return 384;
        }

        if (this.model === 'embed-multilingual-light-v3.0') {
            return 384;
        }

        return 1024;
    }
}