// src/services/retrievalService.ts
import { SearchResultItem } from '../types';
import * as neo4jService from './neo4jService';
import * as qdrantService from './qdrantService';

const MAX_RESULTS_PER_SOURCE = 7; // Max results from Neo4j or Qdrant before combining
const FINAL_CONTEXT_SIZE = 10; // Max number of items to send to LLM after combining/reranking

export interface HybridSearchParams {
    query: string;
    useGraph: boolean;
    useVector: boolean;
    // Add more strategy options here if needed, e.g., weights, reranker model
}

/**
 * Combines results from graph and vector searches.
 * Basic strategy: fetch from both, combine, remove duplicates, and take top N.
 * More advanced: reranking using a cross-encoder or LLM.
 */
export async function hybridSearch(params: HybridSearchParams): Promise<SearchResultItem[]> {
    const { query, useGraph, useVector } = params;
    let graphResults: SearchResultItem[] = [];
    let vectorResults: SearchResultItem[] = [];
    const allResults: SearchResultItem[] = [];

    if (useGraph) {
        try {
            graphResults = await neo4jService.searchLegalTextByKeyword(query, MAX_RESULTS_PER_SOURCE);
            console.log(`Graph search returned ${graphResults.length} results for query: "${query}"`);
        } catch (error) {
            console.error('Error during graph search:', error);
        }
    }

    if (useVector) {
        try {
            // Ensure Qdrant collection exists (optional, can be done at startup)
            // await qdrantService.ensureQdrantCollection();
            vectorResults = await qdrantService.searchSimilarVectors(query, undefined, MAX_RESULTS_PER_SOURCE, 0.7); // score_threshold example
            console.log(`Vector search returned ${vectorResults.length} results for query: "${query}"`);
        } catch (error) {
            console.error('Error during vector search:', error);
        }
    }

    // Combine and de-duplicate (simple de-duplication based on 'id' which should be full_path or qdrant id)
    const combined = new Map<string, SearchResultItem>();

    // Add graph results, prioritizing them if scores are similar or not present
    graphResults.forEach(item => {
        item.score = item.score || 0.5; // Assign a default score if not present
        if (!combined.has(item.id) || (combined.get(item.id)?.score || 0) < item.score) {
            combined.set(item.id, item);
        }
    });

    // Add vector results, potentially overwriting if score is higher
    vectorResults.forEach(item => {
        item.score = item.score || 0.0; // Vector search should always have a score
        if (!combined.has(item.id) || (combined.get(item.id)?.score || 0) < item.score) {
            combined.set(item.id, item);
        }
    });

    // Sort by score (descending)
    const sortedResults = Array.from(combined.values()).sort((a, b) => (b.score || 0) - (a.score || 0));

    console.log(`Combined and sorted ${sortedResults.length} results.`);
    return sortedResults.slice(0, FINAL_CONTEXT_SIZE);
}

// Placeholder for a more advanced reranker if you implement one
// async function rerankResults(query: string, items: SearchResultItem[]): Promise<SearchResultItem[]> {
//   // This could use a cross-encoder model or an LLM to rerank based on relevance to the query.
//   console.log(`Reranking ${items.length} items for query: "${query}" (Not implemented, returning original order)`);
//   return items;
// }
