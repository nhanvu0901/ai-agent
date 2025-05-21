export interface QARequest {
    question: string;
    sessionId?: string;
}

export interface QAResponsePayload {
    answer: string;
    sources?: SearchResultItem[];
    debugInfo?: AgentReasoningTrace;
}

export interface AgentStep {
    step: number;
    thought: string;
    action: string;
    actionInput: string;
    observation: string | null;
    error?: string;
}

export interface LLMCallTrace {
    prompt: string;
    response: string | null;
    model: string;
    timestamp: string;
    error?: string;
}

export interface AgentReasoningTrace {
    sessionId?: string;
    originalQuery: string;
    status: 'processing' | 'success' | 'error' | 'irrelevant_query' | 'no_results';
    finalAnswer?: string;
    steps: AgentStep[];
    llmCalls?: LLMCallTrace[];
    relevantSources?: SearchResultItem[];
}

export interface SearchResultItem {
    id: string;
    score?: number;
    type: 'graph' | 'vector' | 'text_chunk' | 'law' | 'paragraph' | 'subsection' | 'unknown';
    content: string;
    title?: string;
    law_id?: string;
    full_path?: string;
    metadata: Record<string, any>;
}

export interface Neo4jLawNode {
    law_id: string;
    title: string;
    promulgation_date?: string;
    effective_date?: string;
    source_file?: string;
    full_text_content?: string;
}

export interface Neo4jParagraphNode {
    identifier: string;
    text: string;
    law_id: string;
    full_path: string;
    title?: string;
}

export interface Neo4jSubsectionNode {
    identifier: string;
    text: string;
    law_id: string;
    full_path: string;
}

export interface QdrantPayload {
    text: string;
    law_id: string;
    full_path: string;
    title?: string;
    source_file?: string;
    type?: 'law' | 'part' | 'head' | 'paragraph' | 'subsection' | 'vector';
}

export type ToolName =
    | 'graphSearch'
    | 'vectorSearch'
    | 'hybridSearch'
    | 'answerGenerator'
    | 'relevanceChecker'
    | 'analyzeQuery'
    | 'finish';

export interface ToolInput {
    query?: string;
    [key: string]: any;
}

export interface ToolResult {
    output: any;
    metadata?: Record<string, any>;
}