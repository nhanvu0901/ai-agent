export interface EmbeddingProvider {

    embedQuery(text: string): Promise<number[]>;


    embedBatch(texts: string[]): Promise<number[][]>;


    getDimension(): number;
}