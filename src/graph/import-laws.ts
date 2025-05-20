// import neo4j, { Driver, Session, Transaction, Neo4jError } from 'neo4j-driver';
// import fs from 'fs';
// import path from 'path';
//
// // --- Neo4j Connection Details ---
// const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
// const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
// const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';
//
// const JSON_DATA_DIR = '/app/data/json';
//
// interface LawMetadata {
//   law_id: string;
//   title: string;
//   promulgation_date?: string;
//   effective_date?: string;
//   agency?: string;
//   references?: string[];
//   source_file?: string;
// }
//
// interface BaseStructuralElement {
//   type: string;
//   identifier: string;
//   title?: string;
//   text?: string;
// }
//
// interface SubsectionLevel2 extends BaseStructuralElement {
//   type: "subsection_level2";
//   text: string;
// }
//
// interface SubsectionLevel1 extends BaseStructuralElement {
//   type: "subsection_level1";
//   content: (string | SubsectionLevel2)[];
// }
//
// interface Paragraph extends BaseStructuralElement {
//   type: "paragraph";
//   subsections?: (SubsectionLevel1 | SubsectionLevel2)[];
// }
//
// interface Head extends BaseStructuralElement {
//   type: "head";
//   paragraphs: Paragraph[];
// }
//
// interface Part extends BaseStructuralElement {
//   type: "part";
//   heads?: Head[];
//   paragraphs?: Paragraph[];
// }
//
// interface LawJson {
//   metadata: LawMetadata;
//   text_content: string[];
//   structured_text: Part[];
// }
//
// function isNeo4jError(error: any): error is Neo4jError {
//   return error instanceof Error && 'code' in error && typeof error.code === 'string';
// }
//
// class Neo4jImporter {
//   private driver: Driver;
//
//   constructor(uri: string, user: string, pass: string) {
//     this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
//   }
//
//   async verifyConnectivity(): Promise<void> {
//     await this.driver.verifyConnectivity();
//     console.log('Neo4j Driver connected and verified.');
//   }
//
//   async close(): Promise<void> {
//     await this.driver.close();
//   }
//
//   async initializeSchema(session: Session): Promise<void> {
//     console.log('Initializing schema...');
//     const constraintsAndIndexes = [
//       'CREATE CONSTRAINT law_id_unique IF NOT EXISTS FOR (l:Law) REQUIRE l.law_id IS UNIQUE',
//       'CREATE CONSTRAINT agency_name_unique IF NOT EXISTS FOR (a:Agency) REQUIRE a.name IS UNIQUE',
//       'CREATE INDEX law_title_index IF NOT EXISTS FOR (l:Law) ON (l.title)',
//       'CREATE INDEX part_identifier_index IF NOT EXISTS FOR (p:Part) ON (p.identifier, p.law_id)',
//       'CREATE INDEX head_identifier_index IF NOT EXISTS FOR (h:Head) ON (h.identifier, h.law_id)',
//       'CREATE INDEX paragraph_identifier_index IF NOT EXISTS FOR (p:Paragraph) ON (p.identifier, p.law_id)',
//       'CREATE INDEX subsection_identifier_index IF NOT EXISTS FOR (s:Subsection) ON (s.identifier, s.law_id)',
//     ];
//
//     for (const query of constraintsAndIndexes) {
//       try {
//         await session.run(query);
//       } catch (error) {
//         if (isNeo4jError(error) && (error.message.includes('already exists') || error.message.includes('ConstraintAlreadyExists') || error.message.includes('IndexAlreadyExists'))) {
//           console.log(`Schema element from query "${query.substring(0, 50)}..." already exists or non-critical error: ${error.message}`);
//         } else {
//           console.error(`Error running schema query "${query.substring(0,50)}...":`, error);
//           throw error;
//         }
//       }
//     }
//     console.log('Schema initialization complete (or elements already exist).');
//   }
//
//   private async processNestedSubsections(
//       tx: Transaction,
//       parentNodeId: number,
//       subsections: (SubsectionLevel1 | SubsectionLevel2)[],
//       lawId: string,
//       parentIdentifierPath: string
//   ) {
//     for (const sub of subsections) {
//       if (typeof sub === 'string') {
//         console.warn(`String content directly under subsection for ${lawId} at ${parentIdentifierPath}. Skipping direct string: "${sub}"`);
//         continue;
//       }
//
//       const subId = sub.identifier || 'unknown_sub';
//       const currentIdentifierPath = `${parentIdentifierPath}_sub:${subId}`;
//       let subNodeText = '';
//
//       if (sub.type === "subsection_level2") {
//         subNodeText = sub.text;
//       } else if (sub.type === "subsection_level1") {
//         const contentParts: string[] = [];
//         if (Array.isArray(sub.content)) {
//           for (const item of sub.content) {
//             if (typeof item === 'string') {
//               contentParts.push(item);
//             } else if (item.type === "subsection_level2" && item.text) {
//               contentParts.push(`${item.identifier || 'unk_id'}) ${item.text}`);
//             }
//           }
//         }
//         subNodeText = contentParts.join('\n');
//       }
//
//       const subResult = await tx.run(
//           `MATCH (parent) WHERE id(parent) = $parentNodeId
//                  CREATE (s:Subsection {identifier: $subIdentifier, text: $subText, law_id: $lawId, full_path: $currentIdentifierPath})
//                  CREATE (parent)-[:HAS_SUBSECTION]->(s)
//                  RETURN id(s) as nodeId`,
//           {
//             parentNodeId,
//             subIdentifier: subId,
//             subText: subNodeText,
//             lawId,
//             currentIdentifierPath
//           }
//       );
//       const subsectionNodeId = subResult.records[0].get('nodeId').toNumber();
//
//       if (sub.type === "subsection_level1" && Array.isArray(sub.content)) {
//         const nestedLevel2Subsections = sub.content.filter(
//             c => typeof c === 'object' && c.type === "subsection_level2"
//         ) as SubsectionLevel2[];
//
//         if (nestedLevel2Subsections.length > 0) {
//           for (const nestedSub of nestedLevel2Subsections) {
//             const nestedSubId = nestedSub.identifier || 'unknown_nested_sub';
//             const nestedPath = `${currentIdentifierPath}_sub:${nestedSubId}`;
//             await tx.run(
//                 `MATCH (s1) WHERE id(s1) = $subsectionNodeId
//                             CREATE (s2:Subsection {identifier: $nestedIdentifier, text: $nestedText, law_id: $lawId, full_path: $nestedPath})
//                             CREATE (s1)-[:HAS_SUBSECTION]->(s2)`,
//                 {
//                   subsectionNodeId,
//                   nestedIdentifier: nestedSubId,
//                   nestedText: nestedSub.text,
//                   lawId,
//                   nestedPath
//                 }
//             );
//           }
//         }
//       }
//     }
//   }
//
//   async importLawData(lawJson: LawJson): Promise<void> {
//     const session = this.driver.session({database: 'neo4j'});
//     const { metadata, structured_text } = lawJson;
//
//     if (!metadata.law_id) {
//       console.warn('Skipping entry due to missing law_id:', metadata.title);
//       await session.close();
//       return;
//     }
//     console.log(`Processing Law: ${metadata.law_id} - ${metadata.title}`);
//
//     try {
//       await session.writeTransaction(async tx => {
//         const lawResult = await tx.run(
//             `MERGE (l:Law {law_id: $law_id})
//                      ON CREATE SET l.title = $title, l.promulgation_date = $p_date, l.effective_date = $e_date, l.source_file = $s_file, l.full_text_content = $textContent
//                      ON MATCH SET l.title = $title, l.promulgation_date = $p_date, l.effective_date = $e_date, l.source_file = $s_file, l.full_text_content = $textContent
//                      RETURN id(l) as nodeId`,
//             {
//               law_id: metadata.law_id,
//               title: metadata.title,
//               p_date: metadata.promulgation_date || null,
//               e_date: metadata.effective_date || null,
//               s_file: metadata.source_file || null,
//               textContent: lawJson.text_content.join("\n")
//             }
//         );
//         const lawNodeId = lawResult.records[0].get('nodeId').toNumber();
//
//         if (metadata.agency) {
//           await tx.run(
//               `MATCH (l:Law {law_id: $lawId})
//                          MERGE (ag:Agency {name: $agencyName})
//                          MERGE (ag)-[:ENFORCES]->(l)`,
//               { lawId: metadata.law_id, agencyName: metadata.agency }
//           );
//         }
//
//         if (metadata.references && metadata.references.length > 0) {
//           for (const refText of metadata.references) {
//             const match = refText.match(/z[áa]kona[\s\S]*?(\d+\/\d+\sSb\.)/i) || refText.match(/Zákon[\s\S]*?(\d+\/\d+\sSb\.)/i);
//             const referencedLawId = match ? match[1].trim() : null;
//
//             if (referencedLawId) {
//               if (referencedLawId !== metadata.law_id) {
//                 await tx.run(
//                     `MATCH (sourceLaw:Law {law_id: $sourceLawId})
//                                      MERGE (targetLaw:Law {law_id: $targetLawId})
//                                      ON CREATE SET targetLaw.title = "Referenced Law (placeholder for " + $targetLawId + ")"
//                                      MERGE (sourceLaw)-[r:REFERENCES_LAW {reference_text: $refText}]->(targetLaw)`,
//                     { sourceLawId: metadata.law_id, targetLawId: referencedLawId, refText }
//                 );
//               } else {
//                 await tx.run(
//                     `MATCH (sourceLaw:Law {law_id: $sourceLawId})
//                                      MERGE (sourceLaw)-[r:REFERENCES_LAW {reference_text: $refText}]->(sourceLaw)`,
//                     { sourceLawId: metadata.law_id, refText }
//                 );
//               }
//             } else {
//               console.warn(`Could not extract specific law_id from reference: "${refText}" in law ${metadata.law_id}. Creating UnresolvedReference.`);
//               await tx.run(
//                   `MATCH (l:Law {law_id: $lawId})
//                                 CREATE (ur:UnresolvedReference {text: $refText})
//                                 CREATE (l)-[:HAS_UNRESOLVED_REFERENCE]->(ur)`,
//                   { lawId: metadata.law_id, refText }
//               );
//             }
//           }
//         }
//
//         let partCounter = 0;
//         for (const part of structured_text) {
//           partCounter++;
//           const partId = part.identifier || `auto_part_${partCounter}`;
//           const partIdentifierPath = `${metadata.law_id}_part:${partId}`;
//           const partResult = await tx.run(
//               `MATCH (l) WHERE id(l) = $lawNodeId
//                          CREATE (p:Part {identifier: $partId, title: $partTitle, law_id: $lawId, full_path: $partIdentifierPath})
//                          CREATE (l)-[:HAS_PART]->(p)
//                          RETURN id(p) as nodeId`,
//               {
//                 lawNodeId,
//                 partId,
//                 partTitle: part.title || null,
//                 lawId: metadata.law_id,
//                 partIdentifierPath
//               }
//           );
//           const partNodeId = partResult.records[0].get('nodeId').toNumber();
//
//           let headCounter = 0;
//           if (part.heads) {
//             for (const head of part.heads) {
//               headCounter++;
//               const headId = head.identifier || `auto_head_${headCounter}`;
//               const headIdentifierPath = `${partIdentifierPath}_head:${headId}`;
//               const headResult = await tx.run(
//                   `MATCH (p) WHERE id(p) = $partNodeId
//                                  CREATE (h:Head {identifier: $headId, title: $headTitle, law_id: $lawId, full_path: $headIdentifierPath})
//                                  CREATE (p)-[:HAS_HEAD]->(h)
//                                  RETURN id(h) as nodeId`,
//                   {
//                     partNodeId,
//                     headId,
//                     headTitle: head.title || null,
//                     lawId: metadata.law_id,
//                     headIdentifierPath
//                   }
//               );
//               const headNodeId = headResult.records[0].get('nodeId').toNumber();
//
//               let paragraphCounterH = 0;
//               if(head.paragraphs) {
//                 for (const paragraph of head.paragraphs) {
//                   paragraphCounterH++;
//                   const paraIdH = paragraph.identifier || `auto_para_h_${paragraphCounterH}`;
//                   const paragraphIdentifierPathH = `${headIdentifierPath}_para:${paraIdH}`;
//                   const paragraphResult = await tx.run(
//                       `MATCH (h_node) WHERE id(h_node) = $headNodeId
//                                          CREATE (para:Paragraph {identifier: $paraId, text: $paraText, law_id: $lawId, full_path: $fullPath})
//                                          CREATE (h_node)-[:HAS_PARAGRAPH]->(para)
//                                          RETURN id(para) as nodeId`,
//                       {
//                         headNodeId: headNodeId, // Ensured this is the correct var name
//                         paraId: paraIdH,
//                         paraText: paragraph.text || '',
//                         lawId: metadata.law_id,
//                         fullPath: paragraphIdentifierPathH
//                       }
//                   );
//                   const paragraphNodeId = paragraphResult.records[0].get('nodeId').toNumber();
//
//                   if (paragraph.subsections && paragraph.subsections.length > 0) {
//                     await this.processNestedSubsections(tx, paragraphNodeId, paragraph.subsections, metadata.law_id, paragraphIdentifierPathH);
//                   }
//                 }
//               }
//             }
//           }
//
//           if (part.paragraphs) {
//             let paragraphCounterP = 0;
//             for (const paragraph of part.paragraphs) {
//               paragraphCounterP++;
//               const paraIdP = paragraph.identifier || `direct_auto_para_p_${paragraphCounterP}`;
//               const paragraphIdentifierPathP = `${partIdentifierPath}_para:${paraIdP}`;
//               const paragraphResult = await tx.run(
//                   `MATCH (p_node) WHERE id(p_node) = $partNodeId
//                                  CREATE (para:Paragraph {identifier: $paraId, text: $paraText, law_id: $lawId, full_path: $fullPath})
//                                  CREATE (p_node)-[:HAS_PARAGRAPH]->(para)
//                                  RETURN id(para) as nodeId`,
//                   {
//                     partNodeId: partNodeId, // Ensured this is the correct var name
//                     paraId: paraIdP,
//                     paraText: paragraph.text || '',
//                     lawId: metadata.law_id,
//                     fullPath: paragraphIdentifierPathP
//                   }
//               );
//               const paragraphNodeId = paragraphResult.records[0].get('nodeId').toNumber();
//
//               if (paragraph.subsections && paragraph.subsections.length > 0) {
//                 await this.processNestedSubsections(tx, paragraphNodeId, paragraph.subsections, metadata.law_id, paragraphIdentifierPathP);
//               }
//             }
//           }
//         }
//         console.log(`Successfully processed and imported Law: ${metadata.law_id}`);
//       });
//     } catch (error) {
//       console.error(`Error processing Law ${metadata.law_id} in transaction:`, error);
//     } finally {
//       await session.close();
//     }
//   }
//
//   async runImportProcess(): Promise<void> {
//     const schemaSession = this.driver.session({ database: 'neo4j' });
//     try {
//       await this.initializeSchema(schemaSession);
//     } catch (schemaError) {
//       console.error("Failed to initialize schema, stopping import:", schemaError);
//       await schemaSession.close();
//       return;
//     } finally {
//       await schemaSession.close();
//     }
//
//     const files = fs.readdirSync(JSON_DATA_DIR).filter(file => file.endsWith('.json'));
//     if (files.length === 0) {
//       console.log(`No JSON files found in ${JSON_DATA_DIR}.`);
//       return;
//     }
//
//     for (const file of files) {
//       const filePath = path.join(JSON_DATA_DIR, file);
//       console.log(`Reading file: ${filePath}`);
//       try {
//         const fileContent = fs.readFileSync(filePath, 'utf-8');
//         const lawData: LawJson = JSON.parse(fileContent);
//         await this.importLawData(lawData);
//       } catch (fileProcessingError) {
//         console.error(`Error parsing or initiating import for file ${filePath}:`, fileProcessingError);
//       }
//     }
//     console.log('All JSON files have been processed.');
//   }
// }
//
// async function main() {
//   console.log(`Connecting to Neo4j at ${NEO4J_URI}`);
//   const importer = new Neo4jImporter(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);
//
//   try {
//     await importer.verifyConnectivity();
//
//     console.log('Starting import process...');
//     console.log(`Looking for JSON files in: ${path.resolve(JSON_DATA_DIR)}`);
//
//     if (!fs.existsSync(JSON_DATA_DIR)) {
//       console.error(`Error: Directory not found: ${JSON_DATA_DIR}`);
//       console.error('Please ensure the JSON_DATA_DIR path is correct and the volume is mounted if using Docker.');
//       return;
//     }
//
//     await importer.runImportProcess();
//     console.log('Import process has concluded.');
//
//   } catch (error) {
//     console.error('A critical error occurred during the import process:', error);
//     if (isNeo4jError(error)) {
//       if (error.code === 'Neo.ClientError.Security.AuthenticationRateLimit') {
//         console.error("Authentication failed: Too many failed attempts. Check credentials and Neo4j server logs.");
//       } else if (error.code === 'Neo.ClientError.Security.Unauthorized') {
//         console.error("Authentication failed: Invalid username or password.");
//       } else if (error.code === 'Neo.ClientError.Database.DatabaseUnavailable') {
//         console.error("Database unavailable. Ensure Neo4j is running and accessible.");
//       }
//     }
//   } finally {
//     await importer.close();
//     console.log('Neo4j connection closed.');
//   }
// }
//
// main().catch(err => {
//   console.error("Unhandled error in main:", err);
// });
// src/graph/import-laws.ts

// src/graph/import-laws.ts

import fs from 'fs';
import path from 'path';
import { Neo4jImporter } from './importer/neo4jImporter';
import { QdrantImporter } from './embeddings/qdrantImporter';
import { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, JSON_DATA_DIR } from './importer/config';
import { isNeo4jError } from './importer/utils';
import { LawJson } from './importer/types';


async function runImportProcess(importer: Neo4jImporter, qdrantImporter: QdrantImporter): Promise<void> {
  const schemaSession = importer['driver'].session({ database: 'neo4j' });
  try {
    // Initialize Neo4j schema
    await importer.initializeSchema(schemaSession);

    // Initialize Qdrant collection
    await qdrantImporter.ensureCollection();
  } catch (schemaError) {
    console.error("Failed to initialize databases, stopping import:", schemaError);
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
      const lawData: LawJson = JSON.parse(fileContent);

      // Import to Neo4j
      await importer.importLawData(lawData);

      // Create vector embeddings and store in Qdrant
      await qdrantImporter.processLaw(lawData);

      console.log(`Successfully processed file ${file} in both Neo4j and Qdrant.`);
    } catch (fileProcessingError) {
      console.error(`Error processing file ${filePath}:`, fileProcessingError);
    }
  }
  console.log('All JSON files have been processed and imported to both Neo4j and Qdrant.');
}


async function main() {
  console.log(`Connecting to Neo4j at ${NEO4J_URI}`);
  const importer = new Neo4jImporter(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);
  const qdrantImporter = new QdrantImporter();

  try {
    await importer.verifyConnectivity();

    console.log('Starting import process...');
    console.log(`Looking for JSON files in: ${path.resolve(JSON_DATA_DIR)}`);

    if (!fs.existsSync(JSON_DATA_DIR)) {
      console.error(`Error: Directory not found: ${JSON_DATA_DIR}`);
      console.error('Please ensure the JSON_DATA_DIR path is correct and the volume is mounted if using Docker.');
      return;
    }


    await runImportProcess(importer, qdrantImporter);
    console.log('Import process has concluded for both Neo4j and Qdrant.');

  } catch (error) {
    console.error('A critical error occurred during the import process:', error);
    if (isNeo4jError(error)) {
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