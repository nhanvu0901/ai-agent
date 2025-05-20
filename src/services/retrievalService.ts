import { SearchResultItem } from '../types';
import * as neo4jService from './neo4jService';
import * as qdrantService from './qdrantService';

const MAX_RESULTS_PER_SOURCE = 7; // Max results from Neo4j or Qdrant before combining
const FINAL_CONTEXT_SIZE = 10; // Max number of items to send to LLM after combining/reranking

export interface HybridSearchParams {
    query: string;
    useGraph: boolean;
    useVector: boolean;
    useFullText?: boolean; // New option to use full-text search
    // Add more strategy options here if needed, e.g., weights, reranker model
}

/**
 * Combines results from graph and vector searches.
 * Basic strategy: fetch from both, combine, remove duplicates, and take top N.
 * More advanced: reranking using a cross-encoder or LLM.
 */
export async function hybridSearch(params: HybridSearchParams): Promise<SearchResultItem[]> {
    const { query, useGraph, useVector, useFullText = true } = params;
    let graphResults: SearchResultItem[] = [];
    let vectorResults: SearchResultItem[] = [];
    let fullTextResults: SearchResultItem[] = [];
    const allResults: SearchResultItem[] = [];

    if (useGraph) {
        try {
            if (useFullText) {
                // Get law results from full-text search
                graphResults = await neo4jService.searchLegalTextByKeyword(query, MAX_RESULTS_PER_SOURCE);

                // Also get paragraph and subsection results from full-text search
                const detailedResults = await neo4jService.searchParagraphsAndSubsectionsByFulltext(
                  query,
                  MAX_RESULTS_PER_SOURCE
                );

                fullTextResults = detailedResults;

                console.log(`Graph + full-text search returned ${graphResults.length} law results and ${fullTextResults.length} paragraph/subsection results for query: "${query}"`);
            } else {
                // Fall back to keyword matching if full-text is disabled
                graphResults = await neo4jService.searchLegalTextByKeyword(query, MAX_RESULTS_PER_SOURCE);
                console.log(`Graph search returned ${graphResults.length} results for query: "${query}"`);
            }
        } catch (error) {
            console.error('Error during graph search:', error);
        }
    }

    if (useVector) {
        try {
            // Use Qdrant for vector search
            vectorResults = await qdrantService.searchSimilarVectors(
              query,
              undefined,
              MAX_RESULTS_PER_SOURCE,
              0.7  // score threshold, adjust as needed
            );
            console.log(`Vector search returned ${vectorResults.length} results for query: "${query}"`);
        } catch (error) {
            console.error('Error during vector search:', error);
        }
    }

    const combined = new Map<string, SearchResultItem>();

    // Helper function to create a unique key for a search result
    const getUniqueKey = (item: SearchResultItem): string => {
        // For items with full_path, use that as it's most specific
        if (item.full_path) {
            return item.full_path;
        }
        // Otherwise use the id
        return item.id;
    };

    // Add graph results
    graphResults.forEach(item => {
        item.score = item.score || 0.5; // Assign a default score if not present
        const key = getUniqueKey(item);
        if (!combined.has(key) || (combined.get(key)?.score || 0) < item.score) {
            combined.set(key, item);
        }
    });

    // Add full-text paragraph and subsection results
    fullTextResults.forEach(item => {
        item.score = item.score || 0.8; // Prioritize full-text matches
        const key = getUniqueKey(item);
        if (!combined.has(key) || (combined.get(key)?.score || 0) < item.score) {
            combined.set(key, item);
        }
    });

    // Add vector results - vector search should always return a score
    vectorResults.forEach(item => {
        const key = getUniqueKey(item);
        // Only add if score is better or item doesn't exist
        if (!combined.has(key) || (combined.get(key)?.score || 0) < (item.score || 0)) {
            combined.set(key, item);
        }
    });

    // Sort by score (descending)
    const sortedResults = Array.from(combined.values()).sort((a, b) => {
        const scoreA = a.score || 0;
        const scoreB = b.score || 0;
        return scoreB - scoreA;
    });

    console.log(`Combined and sorted ${sortedResults.length} results.`);
    return sortedResults.slice(0, FINAL_CONTEXT_SIZE);
}