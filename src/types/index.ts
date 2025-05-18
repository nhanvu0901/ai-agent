// src/types/index.ts

// --- API Request and Response Payloads ---

/**
 * Defines the structure for a question submitted to the AI agent.
 */
export interface QARequest {
    question: string;
    sessionId?: string; // Optional: for tracking conversation history or user sessions
    // You could add other parameters like filters, user profile info, etc.
}

/**
 * Defines the structure of the response payload from the /ask endpoint.
 */
export interface QAResponsePayload {
    answer: string;
    sources?: SearchResultItem[]; // List of sources used to generate the answer
    debugInfo?: AgentReasoningTrace; // Detailed trace of the agent's process, for debugging
}

// --- Agent Reasoning and Tracing ---

/**
 * Represents a single step in the agent's reasoning process.
 */
export interface AgentStep {
    step: number; // Sequential step number
    thought: string; // The agent's reasoning or plan for this step
    action: string; // The tool or function the agent decided to use (e.g., 'hybridSearch', 'generateAnswerWithOpenAI')
    actionInput: string; // Input provided to the action (often JSON stringified object or a simple string)
    observation: string | null; // Result or output from the action (often JSON stringified object, simple string, or null if no direct output)
    error?: string; // Any error message if the step failed
}

/**
 * Traces a single call made to an LLM (e.g., OpenAI).
 */
export interface LLMCallTrace {
    prompt: string; // The full prompt sent to the LLM
    response: string | null; // The content of the LLM's response
    model: string; // The specific LLM model used (e.g., "gpt-3.5-turbo")
    timestamp: string; // ISO string timestamp of when the call was made
    error?: string; // Any error message if the LLM call failed
}

/**
 * Captures the entire reasoning process of the AI agent for a given query.
 */
export interface AgentReasoningTrace {
    sessionId?: string;
    originalQuery: string;
    status: 'processing' | 'success' | 'error' | 'irrelevant_query' | 'no_results'; // Overall status of query processing
    finalAnswer?: string; // The final answer provided to the user
    steps: AgentStep[]; // Array of all steps taken by the agent
    llmCalls?: LLMCallTrace[]; // Array of all LLM calls made during processing
    relevantSources?: SearchResultItem[]; // List of search results deemed relevant by the agent
}

// --- Search Results and Data Structures ---

/**
 * Represents a single item retrieved from a search operation (Graph, Vector, or Hybrid).
 */
export interface SearchResultItem {
    id: string; // Unique identifier for the search result (e.g., Neo4j node ID, Qdrant point ID, full_path)
    score?: number; // Relevance score (especially from vector/hybrid search)
    type: 'graph' | 'vector' | 'text_chunk' | 'law' | 'paragraph' | 'subsection' | 'unknown'; // Origin or type of the search result
    content: string; // The actual text content of the result (e.g., paragraph text, law title)
    title?: string; // Title associated with the content (e.g., Law title, Section title)
    law_id?: string; // Identifier of the law this result pertains to
    full_path?: string; // A structured path identifier, especially for Neo4j items (e.g., "law_id/part_id/paragraph_id")
    metadata: Record<string, any>; // Any other relevant metadata (e.g., source_file, promulgation_date, custom tags)
}

// --- Neo4j Specific Data Structures (examples based on your schema) ---

/**
 * Represents a Law node as retrieved from Neo4j.
 * Adjust properties based on what your Cypher queries return.
 */
export interface Neo4jLawNode {
    law_id: string;
    title: string;
    promulgation_date?: string;
    effective_date?: string;
    source_file?: string;
    full_text_content?: string; // If you fetch the full text
    // Add other properties from your Law nodes
}

/**
 * Represents a Paragraph node as retrieved from Neo4j.
 */
export interface Neo4jParagraphNode {
    identifier: string; // e.g., "§ 1"
    text: string;
    law_id: string;
    full_path: string; // e.g., "328/1991 Sb._part:ČÁST PRVN_para:§ 1"
    title?: string; // Could be the title of the parent Law or Head
    // Add other properties from your Paragraph nodes
}

/**
 * Represents a Subsection node as retrieved from Neo4j.
 */
export interface Neo4jSubsectionNode {
    identifier: string; // e.g., "(1)", "a)"
    text: string;
    law_id: string;
    full_path: string; // e.g., "..._para:§ 1_sub:1"
    // Add other properties
}


// --- Qdrant Specific Data Structures ---

/**
 * Defines the expected structure of the payload stored with vectors in Qdrant.
 * This should match what your data ingestion pipeline puts into Qdrant.
 */
export interface QdrantPayload {
    text: string; // The original text content that was embedded
    law_id: string;
    full_path: string; // Unique identifier for the text chunk (e.g., from Neo4j full_path)
    title?: string; // Title of the law or section this chunk belongs to
    source_file?: string;
    // Add any other metadata you want to store and retrieve from Qdrant
}


// --- Tooling and Agent Internals (Optional - for more advanced agent frameworks) ---

/**
 * Names for the tools available to the agent.
 */
export type ToolName =
    | 'graphSearch'
    | 'vectorSearch'
    | 'hybridSearch'
    | 'answerGenerator'
    | 'relevanceChecker'
    | 'analyzeQuery' // Added for the initial analysis step
    | 'finish'; // Special action to signify completion

/**
 * Generic input structure for an agent tool.
 */
export interface ToolInput {
    query?: string; // Common input, but not always present or named 'query'
    [key: string]: any; // Allows for other tool-specific parameters
}

/**
 * Generic result structure from an agent tool.
 */
export interface ToolResult {
    output: any; // The primary output of the tool
    metadata?: Record<string, any>; // Any additional metadata from the tool execution
}

/**
 * Defines the interface for an agent tool.
 * (Useful if you were to build a more generic tool execution loop).
 */
export interface Tool {
    name: ToolName;
    description: string;
    execute: (input: ToolInput) => Promise<ToolResult>;
    // You might add schema definitions for input/output here for validation
}
