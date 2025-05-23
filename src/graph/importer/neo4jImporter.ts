import neo4j, { Driver, Session, Transaction, Neo4jError } from 'neo4j-driver';
import {
    LawJson,
    LawMetadata,
    SubsectionLevel1,
    SubsectionLevel2
} from './types';
import { isNeo4jError } from './utils';

export class Neo4jImporter {
    private driver: Driver;

    constructor(uri: string, user: string, pass: string) {
        this.driver = neo4j.driver(uri, neo4j.auth.basic(user, pass));
    }

    async verifyConnectivity(): Promise<void> {
        await this.driver.verifyConnectivity();
        console.log('Neo4j Driver connected and verified.');
    }

    async close(): Promise<void> {
        await this.driver.close();
    }

    async initializeSchema(session: Session): Promise<void> {
        console.log('Initializing schema...');
        const constraintsAndIndexes = [
            'CREATE CONSTRAINT law_id_unique IF NOT EXISTS FOR (l:Law) REQUIRE l.law_id IS UNIQUE',
            'CREATE CONSTRAINT agency_name_unique IF NOT EXISTS FOR (a:Agency) REQUIRE a.name IS UNIQUE',
            'CREATE INDEX law_title_index IF NOT EXISTS FOR (l:Law) ON (l.title)',
            'CREATE INDEX part_identifier_index IF NOT EXISTS FOR (p:Part) ON (p.identifier, p.law_id)',
            'CREATE INDEX head_identifier_index IF NOT EXISTS FOR (h:Head) ON (h.identifier, h.law_id)',
            'CREATE INDEX paragraph_identifier_index IF NOT EXISTS FOR (p:Paragraph) ON (p.identifier, p.law_id)',
            'CREATE INDEX subsection_identifier_index IF NOT EXISTS FOR (s:Subsection) ON (s.identifier, s.law_id)',
        ];

        // Add fulltext search index
        const fulltextIndexes = [
            'CREATE FULLTEXT INDEX law_text_content_fulltext IF NOT EXISTS FOR (l:Law) ON EACH [l.text_content]',
            'CREATE FULLTEXT INDEX paragraph_text_fulltext IF NOT EXISTS FOR (p:Paragraph) ON EACH [p.text]',
            'CREATE FULLTEXT INDEX subsection_text_fulltext IF NOT EXISTS FOR (s:Subsection) ON EACH [s.text]'
        ];

        // First create constraints and regular indexes
        for (const query of constraintsAndIndexes) {
            try {
                await session.run(query);
            } catch (error) {
                if (isNeo4jError(error) && (error.message.includes('already exists') || error.message.includes('ConstraintAlreadyExists') || error.message.includes('IndexAlreadyExists'))) {
                    console.log(`Schema element from query "${query.substring(0, 50)}..." already exists or non-critical error: ${error.message}`);
                } else {
                    console.error(`Error running schema query "${query.substring(0,50)}...":`, error);
                    throw error;
                }
            }
        }

        // Then create fulltext indexes
        for (const query of fulltextIndexes) {
            try {
                await session.run(query);
                console.log(`Full-text index created: ${query}`);
            } catch (error) {
                if (isNeo4jError(error) && (error.message.includes('already exists') || error.message.includes('IndexAlreadyExists'))) {
                    console.log(`Full-text index from query "${query.substring(0, 50)}..." already exists: ${error.message}`);
                } else {
                    console.error(`Error creating full-text index "${query.substring(0,50)}...":`, error);
                    throw error;
                }
            }
        }

        console.log('Schema initialization complete (or elements already exist).');
    }

    private async processNestedSubsections(
        tx: Transaction,
        parentNodeId: number,
        subsections: (SubsectionLevel1 | SubsectionLevel2)[],
        lawId: string,
        parentIdentifierPath: string
    ) {
        for (const sub of subsections) {
            if (typeof sub === 'string') {
                console.warn(`String content directly under subsection for ${lawId} at ${parentIdentifierPath}. Skipping direct string: "${sub}"`);
                continue;
            }

            const subId = sub.identifier || 'unknown_sub';
            const currentIdentifierPath = `${parentIdentifierPath}_sub:${subId}`;
            let subNodeText = '';

            if (sub.type === "subsection_level2") {
                subNodeText = sub.text;
            } else if (sub.type === "subsection_level1") {
                const contentParts: string[] = [];
                if (Array.isArray(sub.content)) {
                    for (const item of sub.content) {
                        if (typeof item === 'string') {
                            contentParts.push(item);
                        } else if (item.type === "subsection_level2" && item.text) {
                            contentParts.push(`${item.identifier || 'unk_id'}) ${item.text}`);
                        }
                    }
                }
                subNodeText = contentParts.join('\n');
            }

            const subResult = await tx.run(
                `MATCH (parent) WHERE id(parent) = $parentNodeId
                 CREATE (s:Subsection {identifier: $subIdentifier, text: $subText, law_id: $lawId, full_path: $currentIdentifierPath})
                 CREATE (parent)-[:HAS_SUBSECTION]->(s)
                 RETURN id(s) as nodeId`,
                {
                    parentNodeId,
                    subIdentifier: subId,
                    subText: subNodeText,
                    lawId,
                    currentIdentifierPath
                }
            );
            const subsectionNodeId = subResult.records[0].get('nodeId').toNumber();

            if (sub.type === "subsection_level1" && Array.isArray(sub.content)) {
                const nestedLevel2Subsections = sub.content.filter(
                    c => typeof c === 'object' && c.type === "subsection_level2"
                ) as SubsectionLevel2[];

                if (nestedLevel2Subsections.length > 0) {
                    for (const nestedSub of nestedLevel2Subsections) {
                        const nestedSubId = nestedSub.identifier || 'unknown_nested_sub';
                        const nestedPath = `${currentIdentifierPath}_sub:${nestedSubId}`;
                        await tx.run(
                            `MATCH (s1) WHERE id(s1) = $subsectionNodeId
                            CREATE (s2:Subsection {identifier: $nestedIdentifier, text: $nestedText, law_id: $lawId, full_path: $nestedPath})
                            CREATE (s1)-[:HAS_SUBSECTION]->(s2)`,
                            {
                                subsectionNodeId,
                                nestedIdentifier: nestedSubId,
                                nestedText: nestedSub.text,
                                lawId,
                                nestedPath
                            }
                        );
                    }
                }
            }
        }
    }

    async importLawData(lawJson: LawJson): Promise<void> {
        const session = this.driver.session({database: 'neo4j'});
        const { metadata, structured_text } = lawJson;

        if (!metadata.law_id) {
            console.warn('Skipping entry due to missing law_id:', metadata.title);
            await session.close();
            return;
        }
        console.log(`Processing Law: ${metadata.law_id} - ${metadata.title}`);

        try {
            await session.writeTransaction(async tx => {
                const lawResult = await tx.run(
                    `MERGE (l:Law {law_id: $law_id})
                     ON CREATE SET l.title = $title, l.promulgation_date = $p_date, l.effective_date = $e_date, l.source_file = $s_file, l.text_content = $textContent
                     ON MATCH SET l.title = $title, l.promulgation_date = $p_date, l.effective_date = $e_date, l.source_file = $s_file, l.text_content = $textContent
                     RETURN id(l) as nodeId`,
                    {
                        law_id: metadata.law_id,
                        title: metadata.title,
                        p_date: metadata.promulgation_date || null,
                        e_date: metadata.effective_date || null,
                        s_file: metadata.source_file || null,
                        textContent: lawJson.text_content.join("\n")
                    }
                );
                const lawNodeId = lawResult.records[0].get('nodeId').toNumber();

                if (metadata.agency) {
                    await tx.run(
                        `MATCH (l:Law {law_id: $lawId})
                         MERGE (ag:Agency {name: $agencyName})
                         MERGE (ag)-[:ENFORCES]->(l)`,
                        { lawId: metadata.law_id, agencyName: metadata.agency }
                    );
                }

                if (metadata.references && metadata.references.length > 0) {
                    for (const refText of metadata.references) {
                        const match = refText.match(/z[áa]kona[\s\S]*?(\d+\/\d+\sSb\.)/i) || refText.match(/Zákon[\s\S]*?(\d+\/\d+\sSb\.)/i);
                        const referencedLawId = match ? match[1].trim() : null;

                        if (referencedLawId) {
                            if (referencedLawId !== metadata.law_id) { // Prevent self-reference on the same node with same relationship if IDs are same
                                await tx.run(
                                    `MATCH (sourceLaw:Law {law_id: $sourceLawId})
                                     MERGE (targetLaw:Law {law_id: $targetLawId})
                                     ON CREATE SET targetLaw.title = "Referenced Law (placeholder for " + $targetLawId + ")"
                                     MERGE (sourceLaw)-[r:REFERENCES_LAW {reference_text: $refText}]->(targetLaw)`,
                                    { sourceLawId: metadata.law_id, targetLawId: referencedLawId, refText }
                                );
                            } else { // If it's a self-reference (e.g. law references itself)
                                await tx.run(
                                    `MATCH (sourceLaw:Law {law_id: $sourceLawId})
                                     MERGE (sourceLaw)-[r:REFERENCES_LAW {reference_text: $refText}]->(sourceLaw)`,
                                    { sourceLawId: metadata.law_id, refText }
                                );
                            }
                        } else {
                            console.warn(`Could not extract specific law_id from reference: "${refText}" in law ${metadata.law_id}. Creating UnresolvedReference.`);
                            await tx.run(
                                `MATCH (l:Law {law_id: $lawId})
                                CREATE (ur:UnresolvedReference {text: $refText})
                                CREATE (l)-[:HAS_UNRESOLVED_REFERENCE]->(ur)`,
                                { lawId: metadata.law_id, refText }
                            );
                        }
                    }
                }

                let partCounter = 0;
                for (const part of structured_text) {
                    partCounter++;
                    const partId = part.identifier || `auto_part_${partCounter}`;
                    const partIdentifierPath = `${metadata.law_id}_part:${partId}`;
                    const partResult = await tx.run(
                        `MATCH (l) WHERE id(l) = $lawNodeId
                         CREATE (p:Part {identifier: $partId, title: $partTitle, law_id: $lawId, full_path: $partIdentifierPath})
                         CREATE (l)-[:HAS_PART]->(p)
                         RETURN id(p) as nodeId`,
                        {
                            lawNodeId,
                            partId,
                            partTitle: part.title || null,
                            lawId: metadata.law_id,
                            partIdentifierPath
                        }
                    );
                    const partNodeId = partResult.records[0].get('nodeId').toNumber();

                    let headCounter = 0;
                    if (part.heads) {
                        for (const head of part.heads) {
                            headCounter++;
                            const headId = head.identifier || `auto_head_${headCounter}`;
                            const headIdentifierPath = `${partIdentifierPath}_head:${headId}`;
                            const headResult = await tx.run(
                                `MATCH (p) WHERE id(p) = $partNodeId
                                 CREATE (h:Head {identifier: $headId, title: $headTitle, law_id: $lawId, full_path: $headIdentifierPath})
                                 CREATE (p)-[:HAS_HEAD]->(h)
                                 RETURN id(h) as nodeId`,
                                {
                                    partNodeId,
                                    headId,
                                    headTitle: head.title || null,
                                    lawId: metadata.law_id,
                                    headIdentifierPath
                                }
                            );
                            const headNodeId = headResult.records[0].get('nodeId').toNumber();

                            let paragraphCounterH = 0;
                            if(head.paragraphs) {
                                for (const paragraph of head.paragraphs) {
                                    paragraphCounterH++;
                                    const paraIdH = paragraph.identifier || `auto_para_h_${paragraphCounterH}`;
                                    const paragraphIdentifierPathH = `${headIdentifierPath}_para:${paraIdH}`;
                                    const paragraphResult = await tx.run(
                                        `MATCH (h_node) WHERE id(h_node) = $headNodeId
                                         CREATE (para:Paragraph {identifier: $paraId, text: $paraText, law_id: $lawId, full_path: $fullPath})
                                         CREATE (h_node)-[:HAS_PARAGRAPH]->(para)
                                         RETURN id(para) as nodeId`,
                                        {
                                            headNodeId: headNodeId,
                                            paraId: paraIdH,
                                            paraText: paragraph.text || '',
                                            lawId: metadata.law_id,
                                            fullPath: paragraphIdentifierPathH
                                        }
                                    );
                                    const paragraphNodeId = paragraphResult.records[0].get('nodeId').toNumber();

                                    if (paragraph.subsections && paragraph.subsections.length > 0) {
                                        await this.processNestedSubsections(tx, paragraphNodeId, paragraph.subsections, metadata.law_id, paragraphIdentifierPathH);
                                    }
                                }
                            }
                        }
                    }

                    if (part.paragraphs) {
                        let paragraphCounterP = 0;
                        for (const paragraph of part.paragraphs) {
                            paragraphCounterP++;
                            const paraIdP = paragraph.identifier || `direct_auto_para_p_${paragraphCounterP}`;
                            const paragraphIdentifierPathP = `${partIdentifierPath}_para:${paraIdP}`;
                            const paragraphResult = await tx.run(
                                `MATCH (p_node) WHERE id(p_node) = $partNodeId
                                 CREATE (para:Paragraph {identifier: $paraId, text: $paraText, law_id: $lawId, full_path: $fullPath})
                                 CREATE (p_node)-[:HAS_PARAGRAPH]->(para)
                                 RETURN id(para) as nodeId`,
                                {
                                    partNodeId: partNodeId,
                                    paraId: paraIdP,
                                    paraText: paragraph.text || '',
                                    lawId: metadata.law_id,
                                    fullPath: paragraphIdentifierPathP
                                }
                            );
                            const paragraphNodeId = paragraphResult.records[0].get('nodeId').toNumber();

                            if (paragraph.subsections && paragraph.subsections.length > 0) {
                                await this.processNestedSubsections(tx, paragraphNodeId, paragraph.subsections, metadata.law_id, paragraphIdentifierPathP);
                            }
                        }
                    }
                }
                console.log(`Successfully processed and imported Law: ${metadata.law_id}`);
            });
        } catch (error) {
            console.error(`Error processing Law ${metadata.law_id} in transaction:`, error);

        } finally {
            await session.close();
        }
    }

    // New method to perform full-text search against Laws
    async fullTextSearch(searchText: string, limit: number = 10): Promise<any[]> {
        const session = this.driver.session({database: 'neo4j'});
        try {
            // Use the fulltext search procedure with the index we created
            const result = await session.run(
                `CALL db.index.fulltext.queryNodes("law_text_content_fulltext", $searchText) 
                 YIELD node, score
                 RETURN node.law_id AS law_id, 
                        node.title AS title, 
                        score,
                        node.text_content AS snippet
                 ORDER BY score DESC
                 LIMIT $limit`,
                { searchText, limit: neo4j.int(limit) }
            );

            return result.records.map(record => ({
                law_id: record.get('law_id'),
                title: record.get('title'),
                score: record.get('score'),
                snippet: this.extractRelevantSnippet(record.get('snippet'), searchText)
            }));
        } catch (error) {
            console.error('Error executing full-text search:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    // New method to perform full-text search against Paragraphs
    async fullTextSearchParagraphs(searchText: string, limit: number = 20): Promise<any[]> {
        const session = this.driver.session({database: 'neo4j'});
        try {
            // Use the fulltext search procedure with the paragraph index
            const result = await session.run(
                `CALL db.index.fulltext.queryNodes("paragraph_text_fulltext", $searchText) 
                 YIELD node, score
                 MATCH (law:Law {law_id: node.law_id})
                 RETURN node.identifier AS paragraph_id,
                        node.text AS paragraph_text,
                        node.law_id AS law_id,
                        node.full_path AS full_path,
                        law.title AS law_title,
                        score
                 ORDER BY score DESC
                 LIMIT $limit`,
                { searchText, limit: neo4j.int(limit) }
            );

            return result.records.map(record => ({
                paragraph_id: record.get('paragraph_id'),
                paragraph_text: record.get('paragraph_text'),
                law_id: record.get('law_id'),
                full_path: record.get('full_path'),
                law_title: record.get('law_title'),
                score: record.get('score')
            }));
        } catch (error) {
            console.error('Error executing paragraph full-text search:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    // New method to perform full-text search against Subsections
    async fullTextSearchSubsections(searchText: string, limit: number = 20): Promise<any[]> {
        const session = this.driver.session({database: 'neo4j'});
        try {
            // Use the fulltext search procedure with the subsection index
            const result = await session.run(
                `CALL db.index.fulltext.queryNodes("subsection_text_fulltext", $searchText) 
                 YIELD node, score
                 MATCH (law:Law {law_id: node.law_id})
                 RETURN node.identifier AS subsection_id,
                        node.text AS subsection_text,
                        node.law_id AS law_id,
                        node.full_path AS full_path,
                        law.title AS law_title,
                        score
                 ORDER BY score DESC
                 LIMIT $limit`,
                { searchText, limit: neo4j.int(limit) }
            );

            return result.records.map(record => ({
                subsection_id: record.get('subsection_id'),
                subsection_text: record.get('subsection_text'),
                law_id: record.get('law_id'),
                full_path: record.get('full_path'),
                law_title: record.get('law_title'),
                score: record.get('score')
            }));
        } catch (error) {
            console.error('Error executing subsection full-text search:', error);
            throw error;
        } finally {
            await session.close();
        }
    }

    // Helper method to extract relevant text around search terms
    private extractRelevantSnippet(text: string, searchTerms: string, snippetLength: number = 200): string {
        if (!text) return '';

        // Convert search terms to an array and create a regex pattern
        const terms = searchTerms
            .split(' ')
            .filter(term => term.length > 2)
            .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape regex special chars

        if (terms.length === 0) return text.substring(0, snippetLength) + '...';

        const regex = new RegExp(terms.join('|'), 'i');
        const match = text.match(regex);

        if (!match || match.index === undefined) {
            return text.substring(0, snippetLength) + '...';
        }

        const startPos = Math.max(0, match.index - snippetLength / 2);
        const endPos = Math.min(text.length, startPos + snippetLength);

        let snippet = text.substring(startPos, endPos);

        // Add ellipsis if we're not at the beginning or end
        if (startPos > 0) snippet = '...' + snippet;
        if (endPos < text.length) snippet = snippet + '...';

        return snippet;
    }

    // Combined search method that searches across all node types
    async comprehensiveSearch(searchText: string, limit: number = 20): Promise<any> {
        try {
            // Get results from all three search methods
            const [lawResults, paragraphResults, subsectionResults] = await Promise.all([
                this.fullTextSearch(searchText, Math.floor(limit / 3)),
                this.fullTextSearchParagraphs(searchText, Math.floor(limit / 3)),
                this.fullTextSearchSubsections(searchText, Math.floor(limit / 3))
            ]);

            // Return a combined object with all results
            return {
                laws: lawResults,
                paragraphs: paragraphResults,
                subsections: subsectionResults,
                totalResults: lawResults.length + paragraphResults.length + subsectionResults.length
            };
        } catch (error) {
            console.error('Error in comprehensive search:', error);
            throw error;
        }
    }
}