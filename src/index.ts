// src/index.ts
import { createServer } from './api/server';
import config from './config/config';
import dotenv from 'dotenv';


dotenv.config();

console.log('Starting AI Junior application...');
console.log(`Environment: ${config.nodeEnv}`);


if (process.env.AZURE_OPENAI_ENDPOINT && process.env.OPENAI_API_KEY) {
    console.log('Azure OpenAI configuration detected:');
    console.log(`- Endpoint: ${process.env.AZURE_OPENAI_ENDPOINT}`);
    console.log(`- API Version: ${process.env.AZURE_OPENAI_API_VERSION}`);
    console.log(`- Agent Model: ${process.env.AGENT_MODEL_DEPLOYMENT}`);
    console.log(`- Embedding Model: ${process.env.EMBEDDING_MODEL_DEPLOYMENT}`);
}

async function start() {
    try {
        const server = await createServer();

        await server.listen({ port: config.port, host: '0.0.0.0' });

        console.log(`Server is running on port ${config.port}`);
        console.log(`Swagger documentation: http://localhost:${config.port}/documentation`);
        console.log(`Neo4j browser: http://localhost:7474/browser/`);
        console.log(`Qdrant dashboard: http://localhost:6333/dashboard/`);


        const shutdown = async () => {
            console.log('Shutting down server...');
            await server.close();
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (err) {
        console.error('Error starting server:', err);
        process.exit(1);
    }
}


start();