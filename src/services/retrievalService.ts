import { SearchResultItem } from '../types';
import * as neo4jService from './neo4jService';
import * as qdrantService from './qdrantService';
import config from '../config/config';

const MAX_RESULTS_PER_SOURCE = 8;
const FINAL_CONTEXT_SIZE = 10;

export interface HybridSearchParams {
    query: string;
    useGraph: boolean;
    useVector: boolean;
    useFullText?: boolean;
}

export async function hybridSearch(params: HybridSearchParams): Promise<SearchResultItem[]> {
    const { query, useGraph, useVector, useFullText = true } = params;
    let graphResults: SearchResultItem[] = [];
    let vectorResults: SearchResultItem[] = [];
    let fullTextResults: SearchResultItem[] = [];

    const startTime = Date.now();

    try {
        const searchPromises = [];

        if (useGraph) {
            if (useFullText) {
                searchPromises.push(
                    neo4jService.searchLegalTextByKeyword(query, MAX_RESULTS_PER_SOURCE)
                        .then(result => { graphResults = result; })
                        .catch(error => {
                            console.error('Error during graph search:', error);
                            return [];
                        })
                );

                searchPromises.push(
                    neo4jService.searchParagraphsAndSubsectionsByFulltext(query, MAX_RESULTS_PER_SOURCE)
                        .then(result => { fullTextResults = result; })
                        .catch(error => {
                            console.error('Error during full-text search:', error);
                            return [];
                        })
                );
            } else {
                searchPromises.push(
                    neo4jService.searchLegalTextByKeyword(query, MAX_RESULTS_PER_SOURCE)
                        .then(result => { graphResults = result; })
                        .catch(error => {
                            console.error('Error during graph search:', error);
                            return [];
                        })
                );
            }
        }

        if (useVector) {
            searchPromises.push(
                qdrantService.searchSimilarVectors(
                    query,
                    undefined,
                    MAX_RESULTS_PER_SOURCE,
                    0.5
                )
                    .then(result => { vectorResults = result; })
                    .catch(error => {
                        console.error('Error during vector search:', error);
                        return [];
                    })
            );
        }

        await Promise.all(searchPromises);

        console.log(`Graph search returned ${graphResults.length} results for query: "${query}"`);
        console.log(`Full-text search returned ${fullTextResults.length} paragraph/subsection results for query: "${query}"`);
        console.log(`Vector search returned ${vectorResults.length} results for query: "${query}"`);
    } catch (error) {
        console.error('Error during hybrid search:', error);
    }

    const combined = new Map<string, SearchResultItem>();

    const getUniqueKey = (item: SearchResultItem): string => {
        if (item.full_path) {
            return item.full_path;
        }
        return item.id;
    };

    graphResults.forEach(item => {
        item.score = item.score || 0.5;
        const key = getUniqueKey(item);
        if (!combined.has(key) || (combined.get(key)?.score || 0) < item.score) {
            combined.set(key, item);
        }
    });

    fullTextResults.forEach(item => {
        item.score = item.score || 0.8;
        const key = getUniqueKey(item);
        if (!combined.has(key) || (combined.get(key)?.score || 0) < item.score) {
            combined.set(key, item);
        }
    });

    vectorResults.forEach(item => {
        const key = getUniqueKey(item);
        if (!combined.has(key) || (combined.get(key)?.score || 0) < (item.score || 0)) {
            combined.set(key, item);
        }
    });

    if (combined.size === 0) {
        console.warn(`No results found from any source for query: "${query}"`);
    }

    const sortedResults = Array.from(combined.values()).sort((a, b) => {
        const scoreA = a.score || 0;
        const scoreB = b.score || 0;
        return scoreB - scoreA;
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`Hybrid search completed in ${duration}ms.`);
    console.log(`Combined and sorted ${sortedResults.length} unique results.`);

    if (config.debugMode && sortedResults.length > 0) {
        console.log("Top result score:", sortedResults[0].score);
        console.log("Top result type:", sortedResults[0].type);
        console.log("Top result law_id:", sortedResults[0].law_id);
    }

    return sortedResults.slice(0, FINAL_CONTEXT_SIZE);
}