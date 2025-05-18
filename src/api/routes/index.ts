import { FastifyInstance } from 'fastify';
import graphRoutes from './graph';

export default async function (fastify: FastifyInstance) {
  // Register route groups with their base paths
  fastify.register(graphRoutes, { prefix: '/api/graph' });
}