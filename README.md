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

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- OpenAI API key (or Azure OpenAI credentials)

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/ai-junior.git
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

   For Windows (PowerShell as admin):
   ```bash
   wsl bash -c "tr -d '\r' < /mnt/path-to-the-import-laws.sh > /tmp/import-laws_fixed.sh && chmod +x /tmp/import-laws_fixed.sh && bash /tmp/import-laws_fixed.sh"
   ```

   For Mac/Linux:
   ```bash
   ./path-to-the-import-laws.sh
   ```

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

The main API endpoint is:

- **AI Legal Assistant**
    - `POST /api/graph/ask` - Ask legal questions in natural language
        - Request body: `{ "question": "What are the requirements for electronic signatures?" }`
        - Returns an answer with relevant legal sources

## Configuration

The application can be configured using environment variables:

- `OPENAI_API_KEY` - Your OpenAI API key
- `AZURE_OPENAI_ENDPOINT` - Azure OpenAI endpoint (optional)
- `AZURE_OPENAI_API_VERSION` - Azure OpenAI API version (optional)
- `AGENT_MODEL_DEPLOYMENT` - Model to use for the agent (default: gpt-4o-mini)
- `EMBEDDING_MODEL_DEPLOYMENT` - Model to use for embeddings (default: ace-text-embedding-3-large)
- `NEO4J_URI` - Neo4j connection URI
- `NEO4J_USER` - Neo4j username
- `NEO4J_PASSWORD` - Neo4j password
- `QDRANT_URL` - Qdrant connection URL
- `PORT` - Port for the API server (default: 3000)

## Database Schema

The Neo4j graph schema includes:

- **Law**: Represents a single piece of legislation
- **Part**: Major structural part of a law
- **Head**: Chapter within a Part
- **Paragraph**: Specific paragraph of a law (§)
- **Subsection**: Nested subsection within a paragraph

These entities are connected by relationships that represent the hierarchical structure of legal documents.

## Project Structure

```
├── src/
│   ├── agent/            # AI agent implementation
│   ├── api/              # API routes and server setup
│   ├── config/           # Configuration handling
│   ├── graph/            # Neo4j database operations
│   ├── services/         # Core services (OpenAI, Neo4j, Qdrant)
│   └── types/            # TypeScript type definitions
├── data/                 # Data storage
├── Dockerfile            # Container definition
└── docker-compose.yml    # Multi-container setup
```