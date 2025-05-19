import neo4j, {Driver, Session, Record as Neo4jRecord, Neo4jError, int} from 'neo4j-driver';
import config from '../config/config';
import {SearchResultItem, Neo4jParagraphNode, Neo4jLawNode} from '../types';

let driver: Driver | undefined;

function getDriver(): Driver {
  if (!driver) {
    try {
      driver = neo4j.driver(
        config.neo4j.uri,
        neo4j.auth.basic(config.neo4j.user, config.neo4j.password) // Correct: user and password from config
      );
      // Verify connectivity during initialization
      driver.verifyConnectivity()
        .then(() => console.log('Neo4j Driver connected and verified.'))
        .catch(error => console.error('Neo4j Driver connection error:', error));
    } catch (error) {
      console.error('Failed to create Neo4j driver:', error);
      throw new Error('Could not establish Neo4j connection.');
    }
  }
  return driver;
}

export async function closeNeo4jDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = undefined;
    console.log('Neo4j Driver closed.');
  }
}

async function executeQuery(query: string, params: Record<string, any>): Promise<Neo4jRecord[]> {
  const currentDriver = getDriver();
  let session: Session | undefined;
  try {
    session = currentDriver.session({database: 'neo4j'});

    const executionParams = {...params};


    if (executionParams.hasOwnProperty('limit') && typeof executionParams.limit === 'number') {

      executionParams.limit = int(Math.floor(executionParams.limit));
    }


    const result = await session.run(query, executionParams);
    return result.records;
  } catch (error) {
    const neo4jError = error as Neo4jError;
    console.error(`Neo4j query failed: ${neo4jError.message}`, {
      query,
      params, // Log original params for easier debugging
      processedParams: executionParams, // Log processed params
      errorCode: neo4jError.code
    });
    throw new Error(`Neo4j query execution failed: ${neo4jError.message}`);
  } finally {
    if (session) {
      await session.close();
    }
  }
}

export async function searchLegalTextByKeyword(keywords: string, limit: number = 5): Promise<SearchResultItem[]> {
  // Basic keyword matching. Consider using Neo4j full-text search for better results.
  // This query attempts to find keywords in Law titles, Paragraph text, or Subsection text.
  // It prioritizes direct matches in Paragraphs and Subsections.
  const query = `
    // Match Laws by title
    MATCH (l:Law)
    WHERE toLower(l.title) CONTAINS toLower($keywords)
    WITH l, 10 AS score // Assign a base score for law title match
    OPTIONAL MATCH (l)-[:HAS_PART]->()-[:HAS_HEAD|HAS_PARAGRAPH*0..]->(p:Paragraph)
    WHERE p.text IS NOT NULL AND toLower(p.text) CONTAINS toLower($keywords)
    WITH l, p, score + 5 AS newScore // Higher score for paragraph match
    OPTIONAL MATCH (p)-[:HAS_SUBSECTION*1..]->(s:Subsection)
    WHERE s.text IS NOT NULL AND toLower(s.text) CONTAINS toLower($keywords)
    WITH l, p, s, CASE WHEN s IS NOT NULL THEN newScore + 5 ELSE newScore END AS finalScore

    RETURN
      l.law_id AS lawId,
      l.title AS lawTitle,
      COALESCE(s.full_path, p.full_path, l.law_id) AS id,
      COALESCE(s.text, p.text, l.title) AS content,
      CASE
        WHEN s IS NOT NULL THEN 'subsection'
        WHEN p IS NOT NULL THEN 'paragraph'
        ELSE 'law'
      END AS type,
      finalScore AS relevanceScore,
      { law_id: l.law_id, title: l.title, source_file: l.source_file, full_path: COALESCE(s.full_path, p.full_path) } AS metadata
    ORDER BY relevanceScore DESC
    LIMIT $limit

    UNION

    // Match Paragraphs directly
    MATCH (p:Paragraph)<-[*]-(l:Law)
    WHERE toLower(p.text) CONTAINS toLower($keywords)
    WITH l, p, 20 AS score // Higher base score for direct paragraph match
    OPTIONAL MATCH (p)-[:HAS_SUBSECTION*1..]->(s:Subsection)
    WHERE s.text IS NOT NULL AND toLower(s.text) CONTAINS toLower($keywords)
    WITH l, p, s, CASE WHEN s IS NOT NULL THEN score + 5 ELSE score END AS finalScore
    RETURN
      l.law_id AS lawId,
      l.title AS lawTitle,
      COALESCE(s.full_path, p.full_path) AS id,
      COALESCE(s.text, p.text) AS content,
      CASE
        WHEN s IS NOT NULL THEN 'subsection'
        ELSE 'paragraph'
      END AS type,
      finalScore AS relevanceScore,
      { law_id: l.law_id, title: l.title, source_file: l.source_file, full_path: COALESCE(s.full_path, p.full_path) } AS metadata
    ORDER BY relevanceScore DESC
    LIMIT $limit
  `;

  try {
    const records = await executeQuery(query, {keywords: keywords.trim(), limit});
    return records.map(record => ({
      id: record.get('id') as string,
      score: record.get('relevanceScore') as number,
      type: record.get('type') as 'law' | 'paragraph' | 'subsection',
      content: record.get('content') as string,
      title: record.get('lawTitle') as string,
      law_id: record.get('lawId') as string,
      full_path: record.get('id') as string,
      metadata: record.get('metadata') as Record<string, any>,
    }));
  } catch (error) {
    console.error('Error in searchLegalTextByKeyword:', error);
    return [];
  }
}


export async function getLawById(lawId: string): Promise<Neo4jLawNode | null> {
  const query = `
    MATCH (l:Law {law_id: $lawId})
    RETURN l.law_id AS law_id, l.title AS title, l.promulgation_date AS promulgation_date, l.effective_date AS effective_date, l.full_text_content AS full_text_content
    LIMIT 1
  `;
  const records = await executeQuery(query, {lawId});
  if (records.length === 0) return null;
  return records[0].toObject() as Neo4jLawNode;
}


export async function getParagraphByFullPath(fullPath: string): Promise<SearchResultItem | null> {
  const query = `
      MATCH (p:Paragraph {full_path: $fullPath})
      OPTIONAL MATCH (l:Law {law_id: p.law_id}) // Get the parent law for context
      RETURN p.full_path AS id,
             p.text AS content,
             'paragraph' AS type,
             l.title AS lawTitle,
             p.law_id AS law_id,
             p.identifier AS paragraphIdentifier,
             l.source_file AS source_file
      LIMIT 1
    `;
  try {
    const records = await executeQuery(query, {fullPath});
    if (records.length === 0) return null;
    const record = records[0];
    return {
      id: record.get('id') as string,
      content: record.get('content') as string,
      type: 'paragraph',
      title: record.get('lawTitle') as string,
      law_id: record.get('law_id') as string,
      full_path: record.get('id') as string,
      metadata: {
        law_id: record.get('law_id'),
        paragraph_identifier: record.get('paragraphIdentifier'),
        source_file: record.get('source_file'),
        law_title: record.get('lawTitle'),
      },
      score: 1.0, // Default score as it's a direct lookup
    };
  } catch (error) {
    console.error(`Error fetching paragraph by full_path ${fullPath}:`, error);
    return null;
  }
}

// Remember to call closeNeo4jDriver()  shuts down.
// For Fastify, this can be done in a 'onClose' hook.
// server.addHook('onClose', (instance, done) => {
//   closeNeo4jDriver().then(done).catch(done);
// });
