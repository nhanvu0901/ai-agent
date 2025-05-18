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
    apiKey: string;
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
  debugMode:true,
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
  },
  paths: {
    pdfDir: process.env.PDF_DIR || './data/pdfs',
    jsonDir: process.env.JSON_DIR || './data/json',
    uploadDir: process.env.UPLOAD_DIR || './data/uploads',
  },
  agent: {
    model: process.env.AGENT_MODEL || 'gpt-4',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
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
export default config;