// src/graph/import-laws.ts

import fs from 'fs';
import path from 'path';
import { Neo4jImporter } from './importer/neo4jImporter';
import { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, JSON_DATA_DIR } from './importer/config';
import { isNeo4jError } from './importer/utils';
import { LawJson } from './importer/types';

async function runImportProcess(importer: Neo4jImporter): Promise<void> {
  const schemaSession = importer['driver'].session({ database: 'neo4j' });
  try {

    await importer.initializeSchema(schemaSession);
  } catch (schemaError) {
    console.error("Failed to initialize schema, stopping import:", schemaError);
    await schemaSession.close();
    return;
  } finally {
    await schemaSession.close();
  }

  const files = fs.readdirSync(JSON_DATA_DIR).filter(file => file.endsWith('.json'));
  if (files.length === 0) {
    console.log(`No JSON files found in ${JSON_DATA_DIR}.`);
    return;
  }

  for (const file of files) {
    const filePath = path.join(JSON_DATA_DIR, file);
    console.log(`Reading file: ${filePath}`);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lawData: LawJson = JSON.parse(fileContent); // Use LawJson type
      await importer.importLawData(lawData);
    } catch (fileProcessingError) {
      console.error(`Error parsing or initiating import for file ${filePath}:`, fileProcessingError);
    }
  }
  console.log('All JSON files have been processed.');
}


async function main() {
  console.log(`Connecting to Neo4j at ${NEO4J_URI}`);
  const importer = new Neo4jImporter(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

  try {
    await importer.verifyConnectivity();

    console.log('Starting import process...');
    console.log(`Looking for JSON files in: ${path.resolve(JSON_DATA_DIR)}`);

    if (!fs.existsSync(JSON_DATA_DIR)) {
      console.error(`Error: Directory not found: ${JSON_DATA_DIR}`);
      console.error('Please ensure the JSON_DATA_DIR path is correct and the volume is mounted if using Docker.');
      return;
    }
    await runImportProcess(importer);
    console.log('Import process has concluded.');

  } catch (error) {
    console.error('A critical error occurred during the import process:', error);
    if (isNeo4jError(error)) { // Use the imported utility
      if (error.code === 'Neo.ClientError.Security.AuthenticationRateLimit') {
        console.error("Authentication failed: Too many failed attempts. Check credentials and Neo4j server logs.");
      } else if (error.code === 'Neo.ClientError.Security.Unauthorized') {
        console.error("Authentication failed: Invalid username or password.");
      } else if (error.code === 'Neo.ClientError.Database.DatabaseUnavailable') {
        console.error("Database unavailable. Ensure Neo4j is running and accessible.");
      }
    }
  } finally {
    await importer.close();
    console.log('Neo4j connection closed.');
  }
}

main().catch(err => {
  console.error("Unhandled error in main:", err);
});