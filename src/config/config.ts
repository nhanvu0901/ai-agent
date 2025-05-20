import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  debugMode:Boolean;
  neo4j: {
    uri: string;
    user: string;
    password: string;
  };
  qdrant: {
    url: string;
  };
  openai: {
    apiKey: string; // Stays as is, will hold AZURE_API_KEY
    azureEndpoint?: string; // New: For Azure endpoint
    azureApiVersion?: string; // New: For Azure API version
    // It's generally better to pass deployment names directly where needed
    // or map them via the agent model/embeddingModel config.
  };
  paths: {
    pdfDir: string;
    jsonDir: string;
    uploadDir: string;
  };
  agent: {
    model: string; // Will use AZURE_OPENAI_CHAT_MODEL_DEPLOYMENT
    embeddingModel: string; // Will use AZURE_OPENAI_EMBED_MODEL_DEPLOYMENT
    contextWindowSize: number;
  };
}

const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  debugMode:process.env.DEBUG_MODE,
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '', // This will load your AZURE_API_KEY
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT, // Load new env variable
    azureApiVersion: process.env.AZURE_OPENAI_API_VERSION, // Load new env variable
  },
  paths: {
    pdfDir: process.env.PDF_DIR || './data/pdfs',
    jsonDir: process.env.JSON_DIR || './data/json',
    uploadDir: process.env.UPLOAD_DIR || './data/uploads',
  },
  agent: {
    // Ensure these environment variables are set to your Azure *Deployment Names*
    model: process.env.AGENT_MODEL_DEPLOYMENT || 'gpt-4o-mini', // Use the deployment name for chat
    embeddingModel: process.env.EMBEDDING_MODEL_DEPLOYMENT || 'ace-text-embedding-3-large', // Use the deployment name for embeddings
    contextWindowSize: parseInt(process.env.CONTEXT_WINDOW_SIZE || '4096', 10),
  },
};

[config.paths.pdfDir, config.paths.jsonDir, config.paths.uploadDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Validate configuration
if (!config.openai.apiKey) {
  console.warn('OPENAI_API_KEY is not set. Some features may not work correctly.');
}
if (!config.openai.azureEndpoint) {
  console.warn('AZURE_OPENAI_ENDPOINT is not set. Azure OpenAI features may not work correctly if you intend to use them.');
}
if (!config.openai.azureApiVersion) {
  console.warn('AZURE_OPENAI_API_VERSION is not set. Azure OpenAI features may not work correctly if you intend to use them.');
}

export default config;