import { createServer } from './api/server';
import config  from './config/config';

// Just logging that we're starting to make sure the app is running
console.log('Starting AI Junior application...');
console.log(`Environment: ${config.nodeEnv}`);

async function start() {
    try {
        const server = await createServer();

        // Start the server
        await server.listen({ port: config.port, host: '0.0.0.0' });

        console.log(`Server is running on port ${config.port}`);
        console.log(`Swagger documentation: http://localhost:${config.port}/documentation`);
        console.log(`Neo4j browser: http://localhost:7474/browser/`);
        console.log(`Qdrant dashboard: http://localhost:6333/dashboard/`);

        // Handle graceful shutdown
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

// Start the application
start();