import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import config  from '../config/config';
import routes from './routes';

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
      },
    },
  });

  // Register plugins
  await server.register(cors, {
    origin: true,
  });

  // Register Swagger
  await server.register(swagger, {
    swagger: {
      info: {
        title: 'AI Junior - Czech Legislation Retrieval API',
        description: 'API for querying Czech legislation using graph and vector search',
        version: '1.0.0',
      },

      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
    },
  });

  await server.register(swaggerUI, {
    routePrefix: '/documentation',
  });

  // Register routes
  await server.register(routes);
  
  // Health check endpoint
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  return server;
}
