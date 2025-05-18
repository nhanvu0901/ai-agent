import { FastifyInstance } from 'fastify';
import askEndpoint from './ask';

// Main graph routes plugin
export default async function graphRoutes(fastify: FastifyInstance) {
  // Register all graph-related endpoints
  await fastify.register(askEndpoint);
  
  // We can add more graph-related endpoints here in the future:
  // await fastify.register(articleEndpoint);
  // await fastify.register(referenceEndpoint);
}