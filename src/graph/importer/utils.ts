// src/graph/importer/utils.ts
import { Neo4jError } from 'neo4j-driver';

export function isNeo4jError(error: any): error is Neo4jError {
    return error instanceof Error && 'code' in error && typeof error.code === 'string';
}