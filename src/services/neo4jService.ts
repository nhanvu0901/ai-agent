import neo4j, { Driver, Session, Record as Neo4jRecord, Neo4jError, int } from 'neo4j-driver';
import config from '../config/config';
import { SearchResultItem, Neo4jParagraphNode, Neo4jLawNode } from '../types';

let driver: Driver | undefined;

function getDriver(): Driver {
  if (!driver) {
    try {
      driver = neo4j.driver(
          config.neo4j.uri,
          neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
      );
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

function prepareParameters(params: Record<string, any>): Record<string, any> {
  const processedParams: Record<string, any> = {};

  for (const [key, value] of Object.entries(params)) {
    if (key === 'limit' || key === 'skip' || key.toLowerCase().includes('limit') || key.toLowerCase().includes('skip')) {
      processedParams[key] = neo4j.int(Math.floor(Number(value)));
      console.log(`Converting parameter ${key}: ${value} (${typeof value}) to Neo4j integer: ${processedParams[key]}`);
    } else {
      processedParams[key] = value;
    }
  }

  return processedParams;
}

async function executeQuery(query: string, params: Record<string, any>): Promise<Neo4jRecord[]> {
  const processedParams = prepareParameters(params);

  console.log("Executing Neo4j query with processed parameters:", processedParams);

  const currentDriver = getDriver();
  let session: Session | undefined;
  try {
    session = currentDriver.session({ database: 'neo4j' });
    const result = await session.run(query, processedParams);
    return result.records;
  } catch (error) {
    const neo4jError = error as Neo4jError;
    console.error(`Neo4j query failed: ${neo4jError.message}`, { query, params: processedParams, errorCode: neo4jError.code });
    throw new Error(`Neo4j query execution failed: ${neo4jError.message}`);
  } finally {
    if (session) {
      await session.close();
    }
  }
}

export async function searchLegalTextByKeyword(keywords: string, limit: number = 5): Promise<SearchResultItem[]> {
  const query = `
    CALL db.index.fulltext.queryNodes("law_text_content_fulltext", $keywords) 
    YIELD node, score
    RETURN
      node.law_id AS lawId,
      node.title AS lawTitle,
      node.law_id AS id, 
      CASE 
        WHEN size(node.text_content) > 500 
        THEN left(node.text_content, 500) + '...' 
        ELSE node.text_content 
      END AS content,
      'law' AS type,
      score AS relevanceScore,
      { 
        law_id: node.law_id, 
        title: node.title, 
        source_file: node.source_file,
        score: score
      } AS metadata
    ORDER BY score DESC
    LIMIT $limit
  `;

  try {
    const records = await executeQuery(query, { keywords, limit });
    return records.map(record => ({
      id: record.get('id') as string,
      score: record.get('relevanceScore') as number,
      type: 'law',
      content: record.get('content') as string,
      title: record.get('lawTitle') as string,
      law_id: record.get('lawId') as string,
      full_path: record.get('id') as string,
      metadata: record.get('metadata') as Record<string, any>,
    }));
  } catch (error) {
    console.error('Error in searchLegalTextByKeyword:', error);

    console.log('Falling back to basic keyword search...');
    const fallbackQuery = `
      MATCH (l:Law) 
      WHERE toLower(l.title) CONTAINS toLower($keywords)
      RETURN
        l.law_id AS lawId,
        l.title AS lawTitle,
        l.law_id AS id, 
        l.title AS content,
        'law' AS type,
        1.0 AS relevanceScore,
        { law_id: l.law_id, title: l.title, source_file: l.source_file } AS metadata
      LIMIT $limit
    `;

    try {
      const records = await executeQuery(fallbackQuery, { keywords, limit });
      return records.map(record => ({
        id: record.get('id') as string,
        score: record.get('relevanceScore') as number,
        type: 'law' as 'law' | 'paragraph' | 'subsection',
        content: record.get('content') as string,
        title: record.get('lawTitle') as string,
        law_id: record.get('lawId') as string,
        full_path: record.get('id') as string,
        metadata: record.get('metadata') as Record<string, any>,
      }));
    } catch (fallbackError) {
      console.error('Error in fallback search:', fallbackError);
      return [];
    }
  }
}

export async function searchParagraphsAndSubsectionsByFulltext(
    keywords: string,
    limit: number = 10
): Promise<SearchResultItem[]> {
  const paragraphQuery = `
    CALL db.index.fulltext.queryNodes("paragraph_text_fulltext", $keywords) 
    YIELD node, score
    MATCH (law:Law {law_id: node.law_id})
    RETURN
      node.full_path AS id,
      node.text AS content,
      'paragraph' AS type,
      law.title AS lawTitle,
      node.law_id AS lawId,
      node.full_path AS fullPath,
      score AS relevanceScore,
      { 
        law_id: node.law_id, 
        paragraph_identifier: node.identifier,
        law_title: law.title,
        score: score
      } AS metadata
    ORDER BY score DESC
    LIMIT $limit
  `;

  const subsectionQuery = `
    CALL db.index.fulltext.queryNodes("subsection_text_fulltext", $keywords) 
    YIELD node, score
    MATCH (law:Law {law_id: node.law_id})
    RETURN
      node.full_path AS id,
      node.text AS content,
      'subsection' AS type,
      law.title AS lawTitle,
      node.law_id AS lawId,
      node.full_path AS fullPath,
      score AS relevanceScore,
      { 
        law_id: node.law_id, 
        subsection_identifier: node.identifier,
        law_title: law.title,
        score: score
      } AS metadata
    ORDER BY score DESC
    LIMIT $limit
  `;

  try {
    const [paragraphRecords, subsectionRecords] = await Promise.all([
      executeQuery(paragraphQuery, { keywords, limit: Math.ceil(limit/2) }),
      executeQuery(subsectionQuery, { keywords, limit: Math.floor(limit/2) })
    ]);
    const paragraphResults = paragraphRecords.map(record => ({
      id: record.get('id') as string,
      score: record.get('relevanceScore') as number,
      type: record.get('type') as 'paragraph',
      content: record.get('content') as string,
      title: record.get('lawTitle') as string,
      law_id: record.get('lawId') as string,
      full_path: record.get('fullPath') as string,
      metadata: record.get('metadata') as Record<string, any>,
    }));

    const subsectionResults = subsectionRecords.map(record => ({
      id: record.get('id') as string,
      score: record.get('relevanceScore') as number,
      type: record.get('type') as 'subsection',
      content: record.get('content') as string,
      title: record.get('lawTitle') as string,
      law_id: record.get('lawId') as string,
      full_path: record.get('fullPath') as string,
      metadata: record.get('metadata') as Record<string, any>,
    }));

    return [...paragraphResults, ...subsectionResults]
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, limit);
  } catch (error) {
    console.error('Error in searchParagraphsAndSubsectionsByFulltext:', error);
    return [];
  }
}

export async function getLawById(lawId: string): Promise<Neo4jLawNode | null> {
  const query = `
    MATCH (l:Law {law_id: $lawId})
    RETURN l.law_id AS law_id, l.title AS title, 
           l.promulgation_date AS promulgation_date, 
           l.effective_date AS effective_date, 
           l.text_content AS text_content
    LIMIT 1
  `;
  try {
    const records = await executeQuery(query, { lawId });
    if (records.length === 0) return null;
    return records[0].toObject() as Neo4jLawNode;
  } catch (error) {
    console.error(`Error in getLawById for ${lawId}:`, error);
    return null;
  }
}

export async function getParagraphByFullPath(fullPath: string): Promise<SearchResultItem | null> {
  const query = `
      MATCH (p:Paragraph {full_path: $fullPath})
      OPTIONAL MATCH (l:Law {law_id: p.law_id})
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
    const records = await executeQuery(query, { fullPath });
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
      score: 1.0,
    };
  } catch (error) {
    console.error(`Error fetching paragraph by full_path ${fullPath}:`, error);
    return null;
  }
}