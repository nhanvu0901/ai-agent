import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import * as neo4jService from '../../../services/neo4jService';
import * as qdrantService from '../../../services/qdrantService';
import * as retrievalService from '../../../services/retrievalService';
import { SearchResultItem } from '../../../types';


const SearchQuerySchema = Type.Object({
    query: Type.String({ minLength: 1, description: 'The search query text.' }),
    searchType: Type.Optional(Type.Enum({
        graph: 'graph',
        vector: 'vector',
        hybrid: 'hybrid'
    }, { default: 'hybrid', description: 'Type of search to perform.' })),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10, description: 'Maximum number of results to return.' })),
    threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0.7, description: 'Score threshold for vector search (0-1).' }))
});

type SearchQueryType = Static<typeof SearchQuerySchema>;

// Schema for search response
const SearchResponseSchema = Type.Object({
    results: Type.Array(Type.Object({
        id: Type.String(),
        score: Type.Optional(Type.Number()),
        type: Type.String(),
        content: Type.String(),
        title: Type.Optional(Type.String()),
        law_id: Type.Optional(Type.String()),
        full_path: Type.Optional(Type.String()),
        metadata: Type.Object({}, { additionalProperties: true })
    })),
    query: Type.String(),
    searchType: Type.String(),
    totalResults: Type.Number(),
    executionTimeMs: Type.Number()
});

export default async function searchEndpoint(fastify: FastifyInstance) {
    fastify.get<{ Querystring: SearchQueryType; Reply: { results: SearchResultItem[], query: string, searchType: string, totalResults: number, executionTimeMs: number } }>(
        '/search',
        {
            schema: {
                description: 'Search for legal documents using graph or vector search.',
                tags: ['Search API'],
                summary: 'Perform graph, vector, or hybrid search on legal documents.',
                querystring: SearchQuerySchema,
                response: {
                    200: SearchResponseSchema,
                    400: Type.Object({
                        statusCode: Type.Number(),
                        error: Type.String(),
                        message: Type.String(),
                    }),
                    500: Type.Object({
                        statusCode: Type.Number(),
                        error: Type.String(),
                        message: Type.String(),
                    }),
                },
            },
        },
        async (request: FastifyRequest<{ Querystring: SearchQueryType }>, reply: FastifyReply) => {
            const { query, searchType = 'hybrid', limit = 8, threshold = 0.5 } = request.query;
            request.log.info({ query, searchType, limit }, 'Received search request');

            const startTime = Date.now();
            let results: SearchResultItem[] = [];

            try {
                switch (searchType) {
                    case 'graph':

                        const graphResults = await neo4jService.searchLegalTextByKeyword(query, limit);
                        const detailedResults = await neo4jService.searchParagraphsAndSubsectionsByFulltext(query, limit);


                        const uniqueItems = new Map<string, SearchResultItem>();


                        [...graphResults, ...detailedResults].forEach(item => {
                            const key = item.full_path || item.id;

                            // Only keep the item with the highest score
                            if (!uniqueItems.has(key) || (uniqueItems.get(key)!.score || 0) < (item.score || 0)) {
                                uniqueItems.set(key, item);
                            }
                        });

                        results = Array.from(uniqueItems.values())
                            .sort((a, b) => (b.score || 0) - (a.score || 0))
                            .slice(0, limit);
                        break;

                    case 'vector':
                        results = await qdrantService.searchSimilarVectors(query, undefined, limit, threshold);
                        break;

                    case 'hybrid':
                    default:
                        results = await retrievalService.hybridSearch({
                            query,
                            useGraph: true,
                            useVector: true,
                            useFullText: true
                        });
                        if (results.length > limit) {
                            results = results.slice(0, limit);
                        }
                        break;
                }

                const endTime = Date.now();
                const executionTimeMs = endTime - startTime;

                return reply.status(200).send({
                    results,
                    query,
                    searchType,
                    totalResults: results.length,
                    executionTimeMs
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
                request.log.error({ err: error, query, searchType }, 'Error in /search endpoint');
                return reply.status(500).send({
                    statusCode: 500,
                    error: "Internal Server Error",
                    message: `An error occurred while processing your search: ${errorMessage}`
                });
            }
        }
    );
}