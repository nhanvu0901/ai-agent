# AI Junior: Czech Legislation Knowledge Retrieval System

This project implements a modern AI retrieval system for Czech legislation, combining graph databases, AI agents, and retrieval-augmented generation (RAG) techniques.

## Project Overview

AI Junior extracts structured knowledge from Czech legislative PDFs (eSbírka) and enables AI-driven exploration of this knowledge through:

- A Graph Knowledge Base for laws, articles, entities, and legal references
- An Agentic AI layer that interprets user queries/intents
- A Retrieval-Augmented Generation (RAG) pipeline for deep, reference-backed answers
- An OpenAPI-compatible backend with endpoints for querying legislation

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│  PDF Documents  │────▶│  Preprocessor   │────▶│ Structured JSON │
│    (eSbírka)    │     │                 │     │                 │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   API Layer     │◀───▶│   AI Agent      │◀───▶│   Neo4j Graph   │
│   (Fastify)     │     │   (ReAct)       │     │   Database      │
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

1. **PDF Preprocessor**
    - Extracts text from PDFs
    - Identifies legal structure (laws, articles, paragraphs)
    - Detects references and entities
    - Produces structured JSON

2. **Neo4j Graph Database**
    - Stores legislative structure
    - Maintains relationships between laws and their components
    - Enables graph traversal queries

3. **Qdrant Vector Database**
    - Stores vector embeddings for semantic search
    - Enables similarity-based retrieval

4. **AI Agent**
    - Interprets user queries
    - Selects appropriate search strategies
    - Combines results into coherent answers
    - Validates responses for accuracy

5. **API Layer**
    - Provides RESTful endpoints
    - Documentation with Swagger UI
    - Authentication and rate limiting

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- OpenAI API key

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

   Edit the `.env` file and add your OpenAI API key.

3. **Start the Docker services**

   ```bash
   docker-compose up -d
   ```

   This will start Neo4j, Qdrant, and the API server.

4. **Access the services**

    - API and Swagger UI: http://localhost:3000/documentation
    - Neo4j Browser: http://localhost:7474 (user: neo4j, password: password)
    - Qdrant Dashboard: http://localhost:6333/dashboard

5 **Import the data**
- In window - `wsl bash -c "tr -d '\r' < /mnt/path-toi-the-import-laws.sh > /tmp/import-laws_fixed.sh && chmod +x /tmp/import-laws_fixed.sh && bash /tmp/import-laws_fixed.sh"`
- In Mac - `./path-to-the-import-laws.sh"`
### Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## API Endpoints

Once the system is running, the following endpoints will be available:

- **Graph Queries**
    - `GET /api/graph/laws` - List all laws
    - `GET /api/graph/law/:id` - Get a specific law with its structure
    - `GET /api/graph/references/:id` - Get all references to/from a law

- **Vector Search**
    - `POST /api/search/semantic` - Semantic search across legislation

- **AI Agent**
    - `POST /api/agent/query` - Ask questions in natural language
    - `GET /api/agent/debug/:queryId` - Get reasoning trace for a query

