# AI Junior: Czech Legislation Knowledge Retrieval System

This project implements an AI-powered retrieval system for Czech legislation, combining graph databases, vector search, and retrieval-augmented generation (RAG) techniques to provide accurate answers to legal questions.

## Project Overview

AI Junior enables intelligent exploration of Czech legislative knowledge through:

- A Graph Database (Neo4j) storing structured legal knowledge
- A Vector Database (Qdrant) enabling semantic search
- A Hybrid Search system combining graph and semantic capabilities
- An Agentic AI layer that interprets user queries and generates accurate responses
- A Fastify-based API with OpenAPI/Swagger documentation

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  User Query     │────▶│  API Layer      │────▶│  Agent Service  │
│                 │     │  (Fastify)      │     │                 │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   OpenAI/Azure  │◀───▶│  Retrieval      │◀───▶│   Neo4j Graph   │
│   Language Model│     │  Service        │     │   Database      │
│                 │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │                 │
                        │ Qdrant Vector   │
                        │ Database        │
                        │                 │
                        └─────────────────┘
```

## Components

1. **Neo4j Graph Database**
    - Stores structured legislative data (laws, parts, paragraphs, subsections)
    - Maintains relationships between legal entities
    - Supports keyword and full-text search capabilities
    - Enables structured queries for precise information retrieval

2. **Qdrant Vector Database**
    - Stores vector embeddings for legal text chunks
    - Enables semantic search beyond keyword matching
    - Finds conceptually similar content even with different terminology

3. **Agent Service**
    - Analyzes user queries to determine intent and relevance
    - Coordinates hybrid search strategies
    - Synthesizes information from multiple sources
    - Generates comprehensive, cited answers

4. **Retrieval Service**
    - Implements hybrid search combining graph and vector approaches
    - Deduplicates and ranks results by relevance
    - Provides context for answer generation

5. **API Layer**
    - RESTful endpoints for legal queries
    - Interactive documentation with Swagger UI
    - Error handling and logging
    - Direct access to graph and vector search capabilities

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- OpenAI API key (or Azure OpenAI credentials)

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/nhanvu0901/ai-agent/
   git checkout final
   cd ai-junior
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit the `.env` file to add your OpenAI API key or Azure OpenAI credentials.

3. **Start the Docker services**

   ```bash
   docker-compose up -d
   ```

   This will start Neo4j, Qdrant, and the application server.

4. **Access the services**
    - API and Swagger UI: http://localhost:3000/documentation
    - Neo4j Browser: http://localhost:7474 (user: neo4j, password: password)
    - Qdrant Dashboard: http://localhost:6333/dashboard

5. **Import legal data**

   The PDF files have already been processed to JSON format in the `data/json` folder. The code for this processing is available in the `process_pdf_data_python` folder.

   To populate the Neo4j and Qdrant databases with this processed data:

   For Docker environment:
   ```bash
   docker exec ai-junior-app node dist/graph/import-laws.js
   ```

   For local development:
   ```bash
   npm run dev:import
   ```

   This will read the JSON files from your data folder and populate both Neo4j and Qdrant databases with structured legal content and vector embeddings.

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in debug mode
npm run dev:debug

# Build for production
npm run build

# Start production build
npm run start
```

## API Endpoints

The main API endpoints are:

- **AI Legal Assistant**
    - `POST /api/graph/ask` - Ask legal questions in natural language
        - Request body: `{ "question": "What are the requirements for electronic signatures?" }`
        - Returns an answer with relevant legal sources

- **Direct Search API**
    - `GET /api/graph/search` - Search for legal documents using graph, vector, or hybrid approaches
        - Query parameters:
            - `query`: The search text (required)
            - `searchType`: "graph", "vector", or "hybrid" (default: "hybrid")
            - `limit`: Maximum number of results to return (default: 10)
            - `threshold`: Score threshold for vector search (default: 0.7)
        - Returns an array of search results with relevance scores and metadata

## Configuration

The application can be configured using environment variables:

- **API and Server**
    - `PORT` - Port for the API server (default: 3000)
    - `NODE_ENV` - Environment setting: "development" or "production"
    - `LOG_LEVEL` - Logging level (default: "info")
    - `DEBUG_MODE` - Enable additional debug information (default: false)

- **OpenAI/Azure Integration**
    - `OPENAI_API_KEY` - Your OpenAI API key or Azure OpenAI API key
    - `AZURE_OPENAI_ENDPOINT` - Azure OpenAI endpoint URL
    - `AZURE_OPENAI_API_VERSION` - Azure OpenAI API version
    - `AGENT_MODEL_DEPLOYMENT` - Model to use for the agent (default: gpt-4o-mini)
    - `EMBEDDING_MODEL_DEPLOYMENT` - Model to use for embeddings (default: ace-text-embedding-3-large)
    - `CONTEXT_WINDOW_SIZE` - Maximum context window size for the LLM (default: 4096)

- **Database Connections**
    - `NEO4J_URI` - Neo4j connection URI
    - `NEO4J_USER` - Neo4j username
    - `NEO4J_PASSWORD` - Neo4j password
    - `QDRANT_URL` - Qdrant connection URL

- **Embedding Configuration**
    - `COHERE_API_KEY` - API key for Cohere embeddings (if used)
    - `EMBEDDING_MODEL` - Model name for embeddings
    - `EMBEDDING_BATCH_SIZE` - Batch size for processing embeddings

## Database Schema

### Neo4j Graph Schema

The Neo4j graph schema includes:

- **Law**: Represents a single piece of legislation
    - Properties: law_id, title, promulgation_date, effective_date, source_file, text_content

- **Agency**: Represents a legal or governmental agency
    - Properties: name

- **Part**: Major structural part of a law
    - Properties: identifier, title, law_id, full_path

- **Head**: Chapter within a Part
    - Properties: identifier, title, law_id, full_path

- **Paragraph**: Specific paragraph of a law (§)
    - Properties: identifier, text, law_id, full_path

- **Subsection**: Nested subsection within a paragraph
    - Properties: identifier, text, law_id, full_path

These entities are connected by relationships that represent the hierarchical structure of legal documents, including:
- ENFORCES: (Agency)-[:ENFORCES]->(Law)
- REFERENCES_LAW: (Law)-[:REFERENCES_LAW]->(Law)
- HAS_PART: (Law)-[:HAS_PART]->(Part)
- HAS_HEAD: (Part)-[:HAS_HEAD]->(Head)
- HAS_PARAGRAPH: (Head/Part)-[:HAS_PARAGRAPH]->(Paragraph)
- HAS_SUBSECTION: (Paragraph/Subsection)-[:HAS_SUBSECTION]->(Subsection)

### Qdrant Vector Schema

The Qdrant vector database stores:

- **Vector Collection**: "legal_documents"
    - Vector dimension: Typically 1024 for Cohere embeddings
    - Distance metric: Cosine similarity

- **Vector Payload**:
    - text: The original text content that was embedded
    - law_id: Identifier of the associated law
    - full_path: Hierarchical path to locate the content in the document structure
    - title: Title of the law or section
    - source_file: Original source file
    - type: Content type (law, part, head, paragraph, subsection)
    - original_id: Original string identifier before numeric conversion

## Project Structure

```
├── src/
│   ├── agent/            # AI agent implementation
│   │   ├── agentService.ts  # Agent orchestration logic
│   │   └── prompts.ts       # System prompts for AI responses
│   ├── api/              # API routes and server setup
│   │   ├── routes/          # API endpoints
│   │   │   ├── graph/       # Graph-related endpoints
│   │   │   │   ├── ask.ts      # QA endpoint
│   │   │   │   └── search.ts   # Search endpoint
│   │   │   └── index.ts     # Route registration
│   │   └── server.ts        # Fastify server configuration
│   ├── config/           # Configuration handling
│   │   └── config.ts        # Environment configuration
│   ├── graph/            # Neo4j database operations
│   │   ├── embeddings/      # Vector embedding utilities
│   │   │   ├── cohereEmbeddings.ts # Cohere embedding implementation
│   │   │   ├── embeddingProvider.ts # Embedding interface
│   │   │   └── qdrantImporter.ts # Qdrant import logic
│   │   ├── importer/        # Data import utilities
│   │   │   ├── config.ts    # Import configuration
│   │   │   ├── neo4jImporter.ts # Neo4j import logic
│   │   │   ├── types.ts     # Type definitions for import
│   │   │   └── utils.ts     # Utility functions
│   │   └── import-laws.ts   # Main import script
│   ├── services/         # Core services
│   │   ├── neo4jService.ts  # Neo4j database interaction
│   │   ├── openAIService.ts # OpenAI/Azure API integration
│   │   ├── qdrantService.ts # Qdrant vector database integration
│   │   └── retrievalService.ts # Hybrid search implementation
│   └── types/            # TypeScript type definitions
│       └── index.ts         # Shared type definitions
├── data/                 # Data storage
│   ├── json/               # Processed JSON files
│   ├── pdfs/               # Source PDF documents
│   └── uploads/            # User upload directory
├── process_pdf_data_python/ # Python code for processing PDFs to JSON
│   └── main.py              # Main PDF processing script
├── shell_scripts/       # Helper shell scripts
│   ├── debug-ports.sh      # Script to debug port issues
│   ├── import-laws.sh      # Script to run law import process
│   └── setup.sh            # Project setup automation
├── Dockerfile            # Container definition
└── docker-compose.yml    # Multi-container setup
```