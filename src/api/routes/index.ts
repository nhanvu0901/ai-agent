import { FastifyInstance } from 'fastify';
import graphRoutes from './graph';

export default async function (fastify: FastifyInstance) {
  fastify.register(graphRoutes, { prefix: '/api/graph' });
}