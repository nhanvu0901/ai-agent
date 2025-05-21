// src/config/config.ts
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  debugMode: boolean;
  neo4j: {
    uri: string;
    user: string;
    password: string;
  };
  qdrant: {
    url: string;
  };
  openai: {
    apiKey: string;
    azureEndpoint?: string;
    azureApiVersion?: string;
  };
  embeddings: {
    apiKey: string;   // Cohere API key
    model: string;    // Cohere embedding model
    batchSize: number; // Number of embeddings to process in a batch
  };
  paths: {
    pdfDir: string;
    jsonDir: string;
    uploadDir: string;
  };
  agent: {
    model: string;
    embeddingModel: string;
    contextWindowSize: number;
  };
}

const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  debugMode: process.env.DEBUG_MODE === 'true' || process.env.DEBUG_MODE === '1' || false,
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT,
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION,
  },
  embeddings: {
    apiKey: process.env.COHERE_API_KEY || 'rcHJfbnk4UsDArKjG30lDo3YnAS9V6GmXNQ4F8ag',
    model: process.env.EMBEDDING_MODEL || 'embed-multilingual-v3.0',
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '20', 10),
  },
  paths: {
    pdfDir: process.env.PDF_DIR || './data/pdfs',
    jsonDir: process.env.JSON_DIR || './data/json',
    uploadDir: process.env.UPLOAD_DIR || './data/uploads',
  },
  agent: {
    model: process.env.AGENT_MODEL_DEPLOYMENT || 'gpt-4o-mini',
    embeddingModel: process.env.EMBEDDING_MODEL_DEPLOYMENT || 'ace-text-embedding-3-large',
    contextWindowSize: parseInt(process.env.CONTEXT_WINDOW_SIZE || '4096', 10),
  },
};

[config.paths.pdfDir, config.paths.jsonDir, config.paths.uploadDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

if (!config.openai.apiKey) {
  console.warn('OPENAI_API_KEY is not set. LLM functions may not work correctly.');
}

if (!config.openai.azureEndpoint) {
  console.warn('AZURE_OPENAI_ENDPOINT is not set. Azure OpenAI features may not work correctly if you intend to use them.');
}

if (!config.openai.azureApiVersion) {
  console.warn('AZURE_OPENAI_API_VERSION is not set. Azure OpenAI features may not work correctly if you intend to use them.');
}

export default config;